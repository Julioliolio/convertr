const { spawn } = require('child_process');
const { STDERR_BUFFER } = require('./server-config');

// ── FFprobe helpers ──────────────────────────────────────────────────────────

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
    ff.on('error', () => resolve(0));
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
    ff.on('error', () => resolve({ duration: 0, width: 0, height: 0, fps: 30, bitrate: 0 }));
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

// ── FFmpeg helpers ───────────────────────────────────────────────────────────

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
      stderr = (stderr + text).slice(-STDERR_BUFFER);
      if (onProgress) {
        const m = text.match(/frame=\s*(\d+)/);
        if (m) onProgress(parseInt(m[1]));
      }
    });
    ff.on('error', (err) => reject(err));
    ff.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited ${code}: ${stderr.slice(-500)}`));
    });
  });
}

// ── Codec config per output format ──────────────────────────────────────────

const H265_CAPABLE = new Set(['mp4', 'mkv']);

// Browser-native playback set — anything else needs a server-side preview proxy.
// gif is listed but uses <img>, not <video>; callers should special-case it.
const BROWSER_PLAYABLE = new Set(['mp4', 'mov', 'm4v', 'webm', 'ogv', '3gp']);

function isBrowserPlayable(ext) {
  if (!ext) return false;
  return BROWSER_PLAYABLE.has(ext.toLowerCase().replace(/^\./, ''));
}

function getCodecArgs(outputFormat, opts) {
  const { crf, codec, width, fps, audio } = opts;
  const fpsVal = fps && fps !== 'original' ? Math.min(120, Math.max(1, parseInt(fps) || 0)) : 0;
  const scaleFilter = width === -1 ? null : `scale=${width}:-2`;
  const keepAudio = audio !== false && audio !== 'false' && audio !== 0 && audio !== '0';

  let args;
  switch (outputFormat) {
    case 'webm':
      args = keepAudio
        ? ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k']
        : ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-an'];
      break;
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv': {
      const vcodec = H265_CAPABLE.has(outputFormat) && codec === 'h265' ? 'libx265' : 'libx264';
      args = keepAudio
        ? ['-c:v', vcodec, '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k']
        : ['-c:v', vcodec, '-crf', String(crf), '-preset', 'medium', '-an'];
      break;
    }
    default:
      return ['-c:v', 'libx264', '-crf', '23', '-c:a', 'aac'];
  }

  if (fpsVal > 0) args.push('-r', String(fpsVal));
  if (scaleFilter) args.push('-vf', scaleFilter);
  return args;
}

// Args for a "fast cut" — stream-copy with keyframe-aligned trim. Audio is
// preserved or stripped per the `audio` flag. Produces an identical codec
// output in seconds rather than re-encoding.
function getFastCutArgs(audio) {
  const keepAudio = audio !== false && audio !== 'false' && audio !== 0 && audio !== '0';
  return keepAudio
    ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
    : ['-c:v', 'copy', '-an', '-avoid_negative_ts', 'make_zero'];
}

// Low-res h264 mp4 proxy used as the editor preview for inputs the browser
// can't play natively (gif, avi, flv, wmv, ts, mts, older mkv codecs, …).
// Scale long-edge to 720 so decode stays cheap on the client. Keep audio so
// the trim preview isn't silent if the source had sound.
function buildProxyArgs(inputPath, outputPath) {
  return [
    '-i', inputPath,
    '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    outputPath,
  ];
}

// ── File serving helper ─────────────────────────────────────────────────────

const fs = require('fs');

function serveJobFile(jobs, req, res, pathKey, asDownload = false) {
  const job = jobs.get(req.params.jobId);
  if (!job || !job[pathKey] || !fs.existsSync(job[pathKey])) {
    return res.status(404).json({ error: 'Not found' });
  }
  if (asDownload) {
    const ext = job.outputFormat || 'gif';
    res.download(job[pathKey], `converted.${ext}`);
  } else {
    res.sendFile(job[pathKey]);
  }
}

module.exports = {
  getDuration,
  getVideoMeta,
  buildGifFilters,
  runFFmpeg,
  getCodecArgs,
  getFastCutArgs,
  buildProxyArgs,
  isBrowserPlayable,
  serveJobFile,
};
