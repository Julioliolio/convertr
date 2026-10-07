import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import type { ServerMeta, UploadResult } from '../api/upload';
import {
  VALID_OUTPUT, MIME, isBrowserPlayable,
  buildGifFilters, getCodecArgs, getFastCutArgs, buildProxyArgs,
} from './ffmpeg-args';

// In-browser stand-in for server.js, used by the GitHub Pages build
// (`npm run build:web`). Same job model and progress payloads as the
// server's SSE stream, but ffmpeg runs as WebAssembly in a worker and files
// never leave the user's machine. Inputs are mounted read-only (WORKERFS) for
// the duration of each task, so large files aren't copied into wasm memory.
// A single ffmpeg instance runs one task at a time via `enqueue`.

const CORE_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';

export type Message = Record<string, any>;

export interface WebConvertOpts {
  outputFormat: string;
  fps: number | string;
  width: number | string;
  dither: string;
  crf: number;
  codec: string;
  audio: boolean;
  fastCut: boolean;
  trimStart?: number;
  trimEnd?: number;
}

interface Job {
  file: File;
  inputName: string;
  inputSize: number;
  inputFormat: string;
  meta: ServerMeta;
  videoCodec: string;
  preview: Promise<string | null> | null;
  urls: string[];                         // blob URLs to revoke on dispose
  listeners: Set<(m: Message) => void>;
  terminal: Message | null;               // done/error payload, replayed to late listeners
}

const jobs = new Map<string, Job>();
let core: Promise<{ coreURL: string; wasmURL: string }> | null = null;
let instance: Promise<FFmpeg> | null = null;
let logSink: ((line: string) => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

// Fetch the ~32 MB core once per page load. (toBlobURL's progress mode is
// avoided on purpose: the CDN serves the wasm compressed, so Content-Length
// never matches the received bytes and the helper's fallback throws.)
function loadCore() {
  core ??= Promise.all([
    toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, 'text/javascript'),
    toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, 'application/wasm'),
  ]).then(([coreURL, wasmURL]) => ({ coreURL, wasmURL }));
  core.catch(() => { core = null; }); // let a later attempt retry after a network error
  return core;
}

function load(): Promise<FFmpeg> {
  instance ??= (async () => {
    const ff = new FFmpeg();
    ff.on('log', ({ message }) => logSink?.(message));
    await ff.load(await loadCore());
    return ff;
  })();
  instance.catch(() => { instance = null; });
  return instance;
}

// A failed exec can leave the wasm runtime unusable (later runs die with
// "Unrecognized option"), so drop the instance; the next task boots a fresh
// one from the cached core.
function reset(ff: FFmpeg) {
  try { ff.terminate(); } catch {}
  instance = null;
}

function enqueue<T>(task: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const run = queue.then(async () => task(await load()));
  queue = run.catch(() => {});
  return run;
}

async function exec(ff: FFmpeg, args: string[], onLog?: (line: string) => void): Promise<void> {
  let tail = '';
  logSink = (line) => { tail = (tail + '\n' + line).slice(-500); onLog?.(line); };
  let code: number;
  try {
    code = await ff.exec(['-hide_banner', '-nostdin', '-y', ...args]);
  } catch {
    code = -1;
  } finally {
    logSink = null;
  }
  if (code !== 0) {
    reset(ff);
    throw new Error(`FFmpeg exited ${code}: ${tail.trim()}`);
  }
}

// Mount the job's file read-only at /in for one task.
async function withInput<T>(ff: FFmpeg, job: Job, task: (inputPath: string) => Promise<T>): Promise<T> {
  try { await ff.createDir('/in'); } catch { /* already exists */ }
  await ff.mount(FFFSType.WORKERFS, { blobs: [{ name: job.inputName, data: job.file }] }, '/in');
  try {
    return await task(`/in/${job.inputName}`);
  } finally {
    try { await ff.unmount('/in'); } catch { /* instance was reset */ }
  }
}

async function readAsUrl(ff: FFmpeg, path: string, type: string): Promise<{ url: string; size: number }> {
  const data = await ff.readFile(path) as Uint8Array;
  await ff.deleteFile(path);
  return { url: URL.createObjectURL(new Blob([data as BlobPart], { type })), size: data.byteLength };
}

const EMPTY_META: ServerMeta = { duration: 0, width: 0, height: 0, fps: 30, bitrate: 0 };

// ffmpeg's input summary has everything the editor needs; a zero-length
// null encode prints it and exits cleanly (a bare `-i` exits with an error).
async function probe(ff: FFmpeg, inputPath: string): Promise<{ meta: ServerMeta; videoCodec: string }> {
  const lines: string[] = [];
  try {
    await exec(ff, ['-i', inputPath, '-t', '0', '-f', 'null', '-'], line => lines.push(line));
  } catch { /* parse whatever was printed */ }
  const log = lines.join('\n');
  const video = lines.find(l => /Stream #.*: Video: /.test(l)) ?? '';
  const dur = log.match(/Duration: (\d+):(\d+):([\d.]+)/);
  const dims = video.match(/, (\d{2,5})x(\d{2,5})/);
  const fps = video.match(/([\d.]+) fps/) ?? video.match(/([\d.]+) tbr/);
  const kbps = log.match(/bitrate: (\d+) kb\/s/);
  return {
    videoCodec: (video.match(/Video: (\w+)/)?.[1] ?? '').toLowerCase(),
    meta: {
      duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + parseFloat(dur[3]) : 0,
      width:    dims ? +dims[1] : 0,
      height:   dims ? +dims[2] : 0,
      fps:      fps ? parseFloat(fps[1]) : 30,
      bitrate:  kbps ? +kbps[1] * 1000 : 0,
    },
  };
}

function emit(job: Job, msg: Message) {
  if (msg.done || msg.error) job.terminal = msg;
  job.listeners.forEach(fn => fn(msg));
}

// Only one file is ever open in the UI, so a new upload frees the last one.
function disposeAll() {
  for (const job of jobs.values()) job.urls.forEach(u => URL.revokeObjectURL(u));
  jobs.clear();
}

// ── Public API (mirrors the server routes) ──────────────────────────────────

export async function webUpload(file: File, onProgress?: (pct: number) => void): Promise<UploadResult | null> {
  disposeAll();
  const jobId = crypto.randomUUID();
  const inputFormat = (file.name.split('.').pop() || '').toLowerCase();
  try {
    return await enqueue(async (ff) => {
      const job: Job = {
        file, inputName: `input.${inputFormat || 'bin'}`, inputSize: file.size, inputFormat,
        meta: EMPTY_META, videoCodec: '',
        preview: null, urls: [], listeners: new Set(), terminal: null,
      };
      Object.assign(job, await withInput(ff, job, inputPath => probe(ff, inputPath)));
      jobs.set(jobId, job);
      onProgress?.(100);
      return { jobId, meta: job.meta, inputFormat, needsProxy: !isBrowserPlayable(inputFormat) };
    });
  } catch (err) {
    console.error('[convertr] could not open file:', err);
    return null;
  }
}

// Low-res h264 proxy for inputs <video> can't play (gif, avi, mkv, …).
export function webWaitForPreview(jobId: string): Promise<string | null> {
  const job = jobs.get(jobId);
  if (!job || isBrowserPlayable(job.inputFormat)) return Promise.resolve(null);
  job.preview ??= enqueue(async (ff) => {
    const out = `/preview-${jobId}.mp4`;
    await withInput(ff, job, inputPath => exec(ff, buildProxyArgs(inputPath, out)));
    const { url } = await readAsUrl(ff, out, 'video/mp4');
    job.urls.push(url);
    return url;
  }).catch((err) => {
    console.error('[convertr] preview failed:', err);
    return null;
  });
  return job.preview;
}

export function webStartConversion(jobId: string, opts: WebConvertOpts): string | null {
  const job = jobs.get(jobId);
  if (!job) return null;
  job.terminal = null;
  enqueue(ff => withInput(ff, job, inputPath => runConversion(ff, jobId, job, inputPath, opts))).catch((err) => {
    console.error('[convertr] conversion failed:', err);
    emit(job, { error: true, message: err?.message || 'Conversion failed' });
  });
  return jobId;
}

export function webListen(jobId: string, fn: (m: Message) => void): () => void {
  const job = jobs.get(jobId);
  if (!job) { fn({ error: true, message: 'Job not found' }); return () => {}; }
  if (job.terminal) { fn(job.terminal); return () => {}; }
  job.listeners.add(fn);
  return () => { job.listeners.delete(fn); };
}

// ── Conversion (port of runConversion in server.js) ─────────────────────────

async function runConversion(ff: FFmpeg, jobId: string, job: Job, inputPath: string, opts: WebConvertOpts) {
  const outputFormat = VALID_OUTPUT.includes(opts.outputFormat) ? opts.outputFormat : 'gif';
  const { trimStart, trimEnd } = opts;
  const hasTrim = trimStart != null && trimEnd != null && trimEnd > trimStart;
  const trimArgs = hasTrim ? ['-ss', String(trimStart), '-to', String(trimEnd)] : [];
  const duration = hasTrim ? trimEnd! - trimStart! : job.meta.duration;
  const outputPath = `/out-${jobId}.${outputFormat}`;
  const fastCut = opts.fastCut && hasTrim && outputFormat !== 'gif' && job.inputFormat === outputFormat;

  // Map ffmpeg's `time=` stat lines onto [from, from + span] of the bar.
  const tracker = (status: string, from: number, span: number, label: (frame: string) => string) =>
    (line: string) => {
      const t = line.match(/time=(\d+):(\d+):([\d.]+)/);
      const f = line.match(/frame=\s*(\d+)/);
      if (!t && !f) return;
      const secs = t ? +t[1] * 3600 + +t[2] * 60 + parseFloat(t[3]) : 0;
      const pct = from + (duration > 0 ? Math.min(span, Math.round((secs / duration) * span)) : 0);
      emit(job, { status, progress: pct, message: f ? label(f[1]) : 'Encoding...' });
    };

  if (outputFormat === 'gif') {
    const { scaleFilter, ditherVal } = buildGifFilters(opts);
    const palettePath = `/palette-${jobId}.png`;
    emit(job, { status: 'pass1', progress: 35, message: 'Pass 1: building palette...' });
    await exec(ff, [...trimArgs, '-i', inputPath, '-vf', `${scaleFilter},palettegen=stats_mode=full`, palettePath],
      tracker('pass1', 35, 25, f => `Pass 1: analysing frame ${f}...`));
    emit(job, { status: 'pass2', progress: 62, message: 'Pass 2: rendering GIF...' });
    try {
      await exec(ff, [...trimArgs, '-i', inputPath, '-i', palettePath,
        '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=${ditherVal}`, outputPath],
        tracker('pass2', 62, 36, f => `Pass 2: rendering frame ${f}...`));
    } finally {
      try { await ff.deleteFile(palettePath); } catch { /* instance was reset */ }
    }
  } else {
    emit(job, { status: 'encoding', progress: 35, message: fastCut ? 'Fast-cutting…' : 'Encoding...' });
    const codecArgs = fastCut
      ? getFastCutArgs(opts.audio, job.videoCodec, outputFormat)
      : getCodecArgs(outputFormat, {
          crf: Math.min(51, Math.max(0, Math.round(opts.crf) || 23)),
          width: opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(String(opts.width)) || -1)),
          fps: opts.fps,
          audio: opts.audio,
        });
    await exec(ff, [...trimArgs, '-i', inputPath, ...codecArgs, outputPath],
      tracker('encoding', 35, 63, f => fastCut ? `Copying frame ${f}…` : `Encoding frame ${f}...`));
  }

  const { url, size } = await readAsUrl(ff, outputPath, MIME[outputFormat] || 'application/octet-stream');
  job.urls.push(url);
  emit(job, {
    done: true, progress: 100, message: 'Done!',
    resultUrl: url, inputSize: job.inputSize, outputSize: size, outputFormat,
  });
}
