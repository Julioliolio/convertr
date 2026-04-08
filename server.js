const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = 3000;
const TEMP_DIR = path.join(os.tmpdir(), 'converter');

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public-built')));
app.use(express.json());

const VALID_INPUT = /\.(mp4|mov|avi|mkv|webm|flv|wmv|gif|m4v|ts|mts|3gp|ogv)$/i;
const VALID_OUTPUT = ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuidv4()}-input${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (VALID_INPUT.test(file.originalname) || file.mimetype.startsWith('video/') || file.mimetype === 'image/gif') {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

// job store
const jobs = new Map();
// SSE clients
const sseClients = new Map();

function broadcast(jobId, data) {
  const clients = sseClients.get(jobId) || [];
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res => res.write(payload));
  if (data.done || data.error) {
    clients.forEach(res => res.end());
    sseClients.delete(jobId);
  }
}

function cleanup(jobId, delay = 0) {
  setTimeout(() => {
    const job = jobs.get(jobId);
    if (!job) return;
    [job.inputPath, job.palettePath, job.outputPath].forEach(f => {
      if (f) try { fs.unlinkSync(f); } catch {}
    });
    jobs.delete(jobId);
  }, delay);
}

function getDuration(inputPath) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      inputPath,
    ]);
    let out = '';
    ff.stdout.on('data', d => (out += d));
    ff.on('close', () => resolve(parseFloat(out.trim()) || 0));
  });
}

function getVideoMeta(inputPath) {
  return new Promise((resolve) => {
    const ff = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,bit_rate',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      inputPath,
    ]);
    let out = '';
    ff.stdout.on('data', d => (out += d));
    ff.on('close', () => {
      try {
        const j = JSON.parse(out);
        const s = (j.streams && j.streams[0]) || {};
        const f = j.format || {};
        const [num, den] = (s.r_frame_rate || '30/1').split('/').map(Number);
        resolve({
          duration:  parseFloat(f.duration) || 0,
          width:     parseInt(s.width)       || 0,
          height:    parseInt(s.height)      || 0,
          fps:       den > 0 ? num / den     : 30,
          bitrate:   parseInt(f.size ? (f.size * 8 / (parseFloat(f.duration) || 1)) : s.bit_rate) || 0,
        });
      } catch { resolve({ duration: 0, width: 0, height: 0, fps: 30, bitrate: 0 }); }
    });
  });
}

function buildGifFilters(opts) {
  const fpsOriginal = opts.fps === 'original';
  const fps = fpsOriginal ? null : Math.min(60, Math.max(1, parseInt(opts.fps) || 15));
  const width = opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(opts.width) || 640));
  const ditherVal = ['sierra2_4a', 'bayer', 'floyd_steinberg', 'none'].includes(opts.dither)
    ? opts.dither : 'sierra2_4a';
  const fpsPart = fpsOriginal ? '' : `fps=${fps},`;
  const scaleFilter = width === -1
    ? `${fpsPart}scale=iw:-1:flags=lanczos`
    : `${fpsPart}scale=${width}:-1:flags=lanczos`;
  return { scaleFilter, ditherVal, fps, fpsOriginal };
}

function runFFmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    ff.stderr.on('data', chunk => {
      const text = chunk.toString();
      // Keep only the last 2 KB to avoid unbounded growth
      stderr = (stderr + text).slice(-2048);
      if (onProgress) {
        const m = text.match(/frame=\s*(\d+)/);
        if (m) onProgress(parseInt(m[1]));
      }
    });
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// ── Codec config per output format ──
const H265_CAPABLE = new Set(['mp4', 'mkv']);

function getCodecArgs(outputFormat, opts) {
  const { crf, codec, width, fps } = opts;
  const fpsVal = fps && fps !== 'original' ? Math.min(120, Math.max(1, parseInt(fps) || 0)) : 0;
  const scaleFilter = width === -1 ? null : `scale=${width}:-2`;

  let args;
  switch (outputFormat) {
    case 'webm':
      args = ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k'];
      break;
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv': {
      const vcodec = H265_CAPABLE.has(outputFormat) && codec === 'h265' ? 'libx265' : 'libx264';
      args = ['-c:v', vcodec, '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
      break;
    }
    default:
      return ['-c:v', 'libx264', '-crf', '23', '-c:a', 'aac'];
  }

  if (fpsVal > 0) args.push('-r', String(fpsVal));
  if (scaleFilter) args.push('-vf', scaleFilter);
  return args;
}

// ── yt-dlp: download video from URL ──
app.post('/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'No URL provided' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const jobId = uuidv4();
  const outputTemplate = path.join(TEMP_DIR, `${jobId}-input.%(ext)s`);

  jobs.set(jobId, {
    status: 'downloading',
    progress: 0,
    message: 'Starting download...',
    inputPath: null,
    outputPath: null,
    inputSize: 0,
    outputSize: 0,
    outputFormat: null,
  });

  res.json({ jobId });

  const ytdlpMissingHint = process.platform === 'win32'
    ? 'yt-dlp is not installed. Run: winget install yt-dlp.yt-dlp'
    : 'yt-dlp is not installed. Run: brew install yt-dlp';

  // Run yt-dlp in background
  let ytdlp;
  try {
    ytdlp = spawn('yt-dlp', [
    '--no-playlist',
    '--max-filesize', '500m',
    '-f', 'bv*+ba/b',         // best video+audio, fallback to best
    '--merge-output-format', 'mp4',
    '-o', outputTemplate,
    '--progress',
    '--newline',               // one progress line per update
    url,
  ]);
  } catch (err) {
    broadcast(jobId, { error: true, message: ytdlpMissingHint });
    cleanup(jobId, 5000);
    return;
  }

  ytdlp.on('error', () => {
    broadcast(jobId, { error: true, message: ytdlpMissingHint });
    cleanup(jobId, 5000);
  });

  let stderr = '';
  let lastFile = null;

  ytdlp.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    // Parse yt-dlp progress: [download]  45.2% of ~12.34MiB ...
    const m = text.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      const pct = parseFloat(m[1]);
      const job = jobs.get(jobId);
      if (job) {
        job.progress = pct;
        job.message = `Downloading: ${pct.toFixed(1)}%`;
      }
      broadcast(jobId, {
        status: 'downloading',
        progress: Math.round(pct * 0.3), // downloading is 0-30% of total
        message: `Downloading: ${pct.toFixed(1)}%`,
      });
    }
    // Detect merged/destination filename
    const dest = text.match(/\[(?:Merger|download)\] (?:Merging formats into "|Destination: )([^"\n]+)/);
    if (dest) lastFile = dest[1].trim();
  });

  ytdlp.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-2048);
  });

  ytdlp.on('close', async (code) => {
    if (code !== 0) {
      broadcast(jobId, { error: true, message: `Download failed: ${stderr.slice(-300) || 'unknown error'}` });
      cleanup(jobId, 5000);
      return;
    }

    // Find the downloaded file — yt-dlp replaces %(ext)s with the actual extension
    let inputPath = lastFile;
    if (!inputPath || !fs.existsSync(inputPath)) {
      // Fallback: scan TEMP_DIR for files matching our jobId prefix
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`${jobId}-input`));
      if (files.length > 0) {
        inputPath = path.join(TEMP_DIR, files[0]);
      }
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      broadcast(jobId, { error: true, message: 'Download completed but file not found' });
      cleanup(jobId, 5000);
      return;
    }

    const inputSize = fs.statSync(inputPath).size;
    const meta = await getVideoMeta(inputPath);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'downloaded';
      job.inputPath = inputPath;
      job.inputSize = inputSize;
      job.meta = meta;
    }

    broadcast(jobId, {
      status: 'downloaded',
      progress: 30,
      message: 'Download complete. Ready to convert.',
      inputPath,
      inputSize,
      fileName: path.basename(inputPath),
      meta,
    });
  });
});

// ── Upload file (stores it for estimation + conversion, avoids double upload) ──
app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const inputSize = req.file.size;
  const meta = await getVideoMeta(inputPath);
  jobs.set(jobId, { status: 'uploaded', inputPath, inputSize, meta, outputPath: null,
    uploadTimer: setTimeout(() => cleanup(jobId), 30 * 60 * 1000) });
  res.json({ jobId, meta });
});

// ── Estimate output size via 1-second sample encode ──
app.post('/estimate', async (req, res) => {
  const { jobId, outputFormat: fmt, fps, width, dither, crf, codec, trimStart: tsRaw, trimEnd: teRaw } = req.body;
  const job = jobs.get(jobId);
  if (!job || !job.inputPath || !fs.existsSync(job.inputPath)) {
    return res.status(404).json({ error: 'Job not found or file missing' });
  }

  // Kill any running estimate process for this job
  if (job.estimateProcess) {
    try { job.estimateProcess.kill('SIGKILL'); } catch {}
    job.estimateProcess = null;
  }

  const outputFormat = VALID_OUTPUT.includes(fmt) ? fmt : 'gif';
  const fullDuration = job.meta ? job.meta.duration : await getDuration(job.inputPath);
  const trimStart = tsRaw != null ? parseFloat(tsRaw) : 0;
  const trimEnd   = teRaw != null ? parseFloat(teRaw) : fullDuration;
  const trimDuration = Math.max(0.1, trimEnd - trimStart);

  // Multi-point sampling: spread 0.5s samples across the clip for accuracy + speed.
  // Short clips (≤ 2s): 1 sample = full clip.
  // Medium (2–15s):     2 samples at 33% and 67%.
  // Long (> 15s):       3 samples at 20%, 50%, 80%.
  const perSampleDur = Math.min(0.5, trimDuration);
  let samplePoints;
  if (trimDuration <= perSampleDur * 2) {
    samplePoints = [trimStart];
  } else if (trimDuration < 15) {
    samplePoints = [trimStart + trimDuration * 0.33, trimStart + trimDuration * 0.67];
  } else {
    samplePoints = [trimStart + trimDuration * 0.2, trimStart + trimDuration * 0.5, trimStart + trimDuration * 0.8];
  }


  // Per-sample helpers with unique temp paths to allow parallel execution
  const samplePath = (i, ext) => path.join(TEMP_DIR, `${jobId}-est${i}.${ext}`);
  const cleanupAll = (paths) => paths.forEach(f => { try { fs.unlinkSync(f); } catch {} });

  const runEstFFmpegTo = (args, outPath) => new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', ...args]);
    job.estimateProcess = ff;
    let stderr = '';
    ff.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-1024); });
    const timer = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('estimate timeout')); }, 15000);
    ff.on('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(fs.existsSync(outPath) ? fs.statSync(outPath).size : 0);
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-300)}`));
    });
  });

  try {
    let totalSampleBytes = 0;

    if (outputFormat === 'gif') {
      const { scaleFilter, ditherVal } = buildGifFilters({ fps, width, dither });
      // Phase 1: all palette passes in parallel
      const palettePaths = samplePoints.map((_, i) => samplePath(i, 'png'));
      await Promise.all(samplePoints.map((start, i) =>
        runEstFFmpegTo(
          ['-ss', String(start), '-t', String(perSampleDur), '-i', job.inputPath,
           '-vf', `${scaleFilter},palettegen=stats_mode=full`, palettePaths[i]],
          palettePaths[i]
        )
      ));
      // Phase 2: all render passes in parallel (each uses its own palette)
      const gifPaths = samplePoints.map((_, i) => samplePath(i, 'gif'));
      const sizes = await Promise.all(samplePoints.map((start, i) =>
        runEstFFmpegTo(
          ['-ss', String(start), '-t', String(perSampleDur),
           '-i', job.inputPath, '-i', palettePaths[i],
           '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=${ditherVal}`, gifPaths[i]],
          gifPaths[i]
        )
      ));
      totalSampleBytes = sizes.reduce((a, b) => a + b, 0);
      cleanupAll([...palettePaths, ...gifPaths]);
    } else {
      const w = width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(width) || -1));
      const crfVal = Math.min(51, Math.max(0, parseInt(crf) || 23));
      const codecArgs = getCodecArgs(outputFormat, { crf: crfVal, codec: codec || 'h264', width: w, fps });
      const outPaths = samplePoints.map((_, i) => samplePath(i, outputFormat));
      // All video samples in parallel
      const sizes = await Promise.all(samplePoints.map((start, i) =>
        runEstFFmpegTo(
          ['-ss', String(start), '-t', String(perSampleDur), '-i', job.inputPath, ...codecArgs, outPaths[i]],
          outPaths[i]
        )
      ));
      totalSampleBytes = sizes.reduce((a, b) => a + b, 0);
      cleanupAll(outPaths);
    }

    const avgBytesPerSec = totalSampleBytes / (samplePoints.length * perSampleDur);
    const estimatedBytes = Math.round(avgBytesPerSec * trimDuration);
    res.json({ estimatedBytes });
  } catch (err) {
    // Best-effort cleanup of any temp estimate files
    try { cleanupAll(samplePoints.flatMap((_, i) => [samplePath(i, outputFormat), samplePath(i, 'png'), samplePath(i, 'gif')])); } catch {}
    if (!err.message || err.message === 'estimate timeout' || err.message.includes('SIGKILL')) {
      return res.status(408).json({ error: 'Estimate timed out' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Convert from a previously fetched URL (uses inputPath from /fetch job) ──
app.post('/convert-fetched', async (req, res) => {
  const { jobId, outputFormat: fmt, fps, width, dither, crf, codec, trimStart, trimEnd } = req.body;
  const job = jobs.get(jobId);

  if (!job || !job.inputPath || !fs.existsSync(job.inputPath)) {
    return res.status(400).json({ error: 'No downloaded file found for this job' });
  }

  const outputFormat = VALID_OUTPUT.includes(fmt) ? fmt : 'gif';
  const inputPath = job.inputPath;
  const inputSize = job.inputSize;
  const outputPath = path.join(TEMP_DIR, `${jobId}-output.${outputFormat}`);

  job.outputPath = outputPath;
  job.outputFormat = outputFormat;
  if (job.uploadTimer) { clearTimeout(job.uploadTimer); job.uploadTimer = null; }

  res.json({ jobId });

  runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, { fps, width, dither, crf, codec, trimStart, trimEnd });
});

// ── Convert from uploaded file ──
app.post('/convert', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const outputFormat = VALID_OUTPUT.includes(req.body.outputFormat) ? req.body.outputFormat : 'gif';
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const inputSize = req.file.size;
  const outputPath = path.join(TEMP_DIR, `${jobId}-output.${outputFormat}`);

  jobs.set(jobId, { status: 'queued', progress: 0, message: 'Starting...', inputPath, outputPath, inputSize, outputSize: 0, outputFormat });
  res.json({ jobId });

  runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, req.body);
});

// ── Shared conversion logic ──
function runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, opts) {
  // Parse trim options (seconds as floats)
  const trimStart = opts.trimStart != null ? parseFloat(opts.trimStart) : null;
  const trimEnd   = opts.trimEnd   != null ? parseFloat(opts.trimEnd)   : null;
  const hasTrim   = trimStart != null && trimEnd != null && trimEnd > trimStart;
  const trimArgs  = hasTrim ? ['-ss', String(trimStart), '-to', String(trimEnd)] : [];
  const trimDuration = hasTrim ? (trimEnd - trimStart) : null;

  if (outputFormat === 'gif') {
    // ── GIF: 2-pass palette pipeline ──
    const { scaleFilter, ditherVal, fps } = buildGifFilters(opts);
    const palettePath = path.join(TEMP_DIR, `${jobId}-palette.png`);

    const job = jobs.get(jobId);
    Object.assign(job, { status: 'queued', progress: 0, message: 'Starting...', palettePath, outputPath, outputFormat });

    (async () => {
      try {
        const fullDuration = await getDuration(inputPath);
        const duration = trimDuration != null ? trimDuration : fullDuration;
        const estFrames = Math.max(1, Math.round(duration * (fps || 30)));

        job.status = 'pass1';
        broadcast(jobId, { status: 'pass1', progress: 35, message: 'Pass 1: building palette...' });

        await runFFmpeg([
          ...trimArgs,
          '-i', inputPath,
          '-vf', `${scaleFilter},palettegen=stats_mode=full`,
          palettePath,
        ], (frame) => {
          const pct = 35 + Math.min(25, Math.round((frame / estFrames) * 25));
          broadcast(jobId, { status: 'pass1', progress: pct, message: `Pass 1: analysing frame ${frame}...` });
        });

        broadcast(jobId, { status: 'pass2', progress: 62, message: 'Pass 2: rendering GIF...' });

        await runFFmpeg([
          ...trimArgs,
          '-i', inputPath,
          '-i', palettePath,
          '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=${ditherVal}`,
          outputPath,
        ], (frame) => {
          const pct = 62 + Math.min(36, Math.round((frame / estFrames) * 36));
          broadcast(jobId, { status: 'pass2', progress: pct, message: `Pass 2: rendering frame ${frame}...` });
        });

        const outputSize = fs.statSync(outputPath).size;
        job.status = 'done';
        job.outputSize = outputSize;

        broadcast(jobId, {
          done: true, progress: 100, message: 'Done!',
          downloadUrl: `/download/${jobId}`,
          inputSize, outputSize, outputFormat,
        });

        [inputPath, palettePath].forEach(f => { try { fs.unlinkSync(f); } catch {} });
        cleanup(jobId, 10 * 60 * 1000);
      } catch (err) {
        console.error(err);
        broadcast(jobId, { error: true, message: err.message });
        cleanup(jobId, 5000);
      }
    })();

  } else {
    // ── Video format: single-pass ──
    const width = opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(opts.width) || -1));
    const crf = Math.min(51, Math.max(0, parseInt(opts.crf) || 23));
    const codec = opts.codec || 'h264';
    const fps = opts.fps;

    const job = jobs.get(jobId);
    Object.assign(job, { status: 'queued', progress: 0, message: 'Starting...', outputPath, outputFormat });

    (async () => {
      try {
        const fullDuration = await getDuration(inputPath);
        const duration = trimDuration != null ? trimDuration : fullDuration;
        const estFrames = Math.max(1, Math.round(duration * 30));

        job.status = 'encoding';
        broadcast(jobId, { status: 'encoding', progress: 35, message: 'Encoding...' });

        const codecArgs = getCodecArgs(outputFormat, { crf, codec, width, fps });

        await runFFmpeg([
          ...trimArgs,
          '-i', inputPath,
          ...codecArgs,
          outputPath,
        ], (frame) => {
          const pct = 35 + Math.min(63, Math.round((frame / estFrames) * 63));
          broadcast(jobId, { status: 'encoding', progress: pct, message: `Encoding frame ${frame}...` });
        });

        const outputSize = fs.statSync(outputPath).size;
        job.status = 'done';
        job.outputSize = outputSize;

        broadcast(jobId, {
          done: true, progress: 100, message: 'Done!',
          downloadUrl: `/download/${jobId}`,
          inputSize, outputSize, outputFormat,
        });

        try { fs.unlinkSync(inputPath); } catch {}
        cleanup(jobId, 10 * 60 * 1000);
      } catch (err) {
        console.error(err);
        broadcast(jobId, { error: true, message: err.message });
        cleanup(jobId, 5000);
      }
    })();
  }
}

app.get('/progress/:jobId', (req, res) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!sseClients.has(jobId)) sseClients.set(jobId, []);
  sseClients.get(jobId).push(res);

  const job = jobs.get(jobId);
  if (job?.status === 'done') {
    res.write(`data: ${JSON.stringify({ done: true, progress: 100, message: 'Done!', downloadUrl: `/download/${jobId}`, inputSize: job.inputSize, outputSize: job.outputSize, outputFormat: job.outputFormat })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    const list = sseClients.get(jobId);
    if (!list) return;
    const idx = list.indexOf(res);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) sseClients.delete(jobId);
  });
});

// Serve file for preview (no cleanup — file stays for drag)
app.get('/serve/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.outputPath || !fs.existsSync(job.outputPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(job.outputPath);
});

// Serve the downloaded/uploaded input file (used for video preview before conversion)
app.get('/input/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !job.inputPath || !fs.existsSync(job.inputPath)) return res.status(404).json({ error: 'Not found' });
  res.sendFile(job.inputPath);
});

// Download triggers cleanup after a delay (user explicitly saving)
app.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !fs.existsSync(job.outputPath)) return res.status(404).json({ error: 'Not found' });
  const ext = job.outputFormat || 'gif';
  res.download(job.outputPath, `converted.${ext}`);
});

// ── Expose output path for Electron native drag ──
function getJobOutputPath(jobId) {
  const job = jobs.get(jobId);
  return (job && job.outputPath) ? job.outputPath : null;
}

function startServer(port = PORT) {
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`\n  Converter running at http://localhost:${actualPort}\n`);
      resolve(actualPort);
    });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { startServer, getJobOutputPath };
