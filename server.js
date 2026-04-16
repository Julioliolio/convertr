const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const {
  PORT, TEMP_DIR, MAX_FILE_SIZE, VALID_INPUT, VALID_OUTPUT,
  UPLOAD_CLEANUP_MS, CONVERSION_CLEANUP_MS, ERROR_CLEANUP_MS,
  SSE_TIMEOUT_MS, ESTIMATE_TIMEOUT_MS, ESTIMATE_SAMPLE_DUR, STDERR_BUFFER,
} = require('./server-config');

const {
  getDuration, getVideoMeta, buildGifFilters, runFFmpeg,
  getCodecArgs, parseEncodingParams, serveJobFile,
} = require('./server-utils');

const app = express();

if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

app.use(express.static(path.join(__dirname, 'public-built')));
app.use(express.json());

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, TEMP_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `${uuidv4()}-input${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter: (req, file, cb) => {
    if (VALID_INPUT.test(file.originalname) || file.mimetype.startsWith('video/') || file.mimetype === 'image/gif') {
      cb(null, true);
    } else {
      cb(new Error('Unsupported file type'));
    }
  },
});

// ── Job store & SSE clients ─────────────────────────────────────────────────

const jobs = new Map();
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
  return setTimeout(() => {
    const job = jobs.get(jobId);
    if (!job) return;
    [job.inputPath, job.palettePath, job.outputPath].forEach(f => {
      if (f) try { fs.unlinkSync(f); } catch {}
    });
    jobs.delete(jobId);
  }, delay);
}

// ── yt-dlp: download video from URL ─────────────────────────────────────────

app.post('/fetch', async (req, res) => {
  const { url } = req.body;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'No URL provided' });
  }

  try { new URL(url); } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  const jobId = uuidv4();
  const outputTemplate = path.join(TEMP_DIR, `${jobId}-input.%(ext)s`);

  jobs.set(jobId, {
    status: 'downloading', progress: 0, message: 'Starting download...',
    inputPath: null, outputPath: null, inputSize: 0, outputSize: 0, outputFormat: null,
  });

  res.json({ jobId });

  const ytdlpMissingHint = process.platform === 'win32'
    ? 'yt-dlp is not installed. Run: winget install yt-dlp.yt-dlp'
    : 'yt-dlp is not installed. Run: brew install yt-dlp';

  let ytdlp;
  try {
    ytdlp = spawn('yt-dlp', [
      '--no-playlist', '--max-filesize', '500m',
      '-f', 'bv*+ba/b', '--merge-output-format', 'mp4',
      '-o', outputTemplate, '--progress', '--newline', url,
    ]);
  } catch (err) {
    broadcast(jobId, { error: true, message: ytdlpMissingHint });
    cleanup(jobId, ERROR_CLEANUP_MS);
    return;
  }

  ytdlp.on('error', () => {
    broadcast(jobId, { error: true, message: ytdlpMissingHint });
    cleanup(jobId, ERROR_CLEANUP_MS);
  });

  let stderr = '';
  let lastFile = null;

  ytdlp.stdout.on('data', (chunk) => {
    const text = chunk.toString();
    const m = text.match(/\[download\]\s+([\d.]+)%/);
    if (m) {
      const pct = parseFloat(m[1]);
      const job = jobs.get(jobId);
      if (job) { job.progress = pct; job.message = `Downloading: ${pct.toFixed(1)}%`; }
      broadcast(jobId, { status: 'downloading', progress: Math.round(pct * 0.3), message: `Downloading: ${pct.toFixed(1)}%` });
    }
    const dest = text.match(/\[(?:Merger|download)\] (?:Merging formats into "|Destination: )([^"\n]+)/);
    if (dest) lastFile = dest[1].trim();
  });

  ytdlp.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk.toString()).slice(-STDERR_BUFFER);
  });

  ytdlp.on('close', async (code) => {
    if (code !== 0) {
      broadcast(jobId, { error: true, message: `Download failed: ${stderr.slice(-300) || 'unknown error'}` });
      cleanup(jobId, ERROR_CLEANUP_MS);
      return;
    }

    let inputPath = lastFile;
    if (!inputPath || !fs.existsSync(inputPath)) {
      const files = fs.readdirSync(TEMP_DIR).filter(f => f.startsWith(`${jobId}-input`));
      if (files.length > 0) inputPath = path.join(TEMP_DIR, files[0]);
    }

    if (!inputPath || !fs.existsSync(inputPath)) {
      broadcast(jobId, { error: true, message: 'Download completed but file not found' });
      cleanup(jobId, ERROR_CLEANUP_MS);
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
      job.uploadTimer = setTimeout(() => cleanup(jobId), UPLOAD_CLEANUP_MS);
    }

    broadcast(jobId, {
      status: 'downloaded', progress: 30,
      message: 'Download complete. Ready to convert.',
      inputPath, inputSize, fileName: path.basename(inputPath), meta,
    });
  });
});

// ── Upload file ─────────────────────────────────────────────────────────────

app.post('/upload', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const inputSize = req.file.size;
  const meta = await getVideoMeta(inputPath);
  jobs.set(jobId, {
    status: 'uploaded', inputPath, inputSize, meta, outputPath: null,
    uploadTimer: setTimeout(() => cleanup(jobId), UPLOAD_CLEANUP_MS),
  });
  res.json({ jobId, meta });
});

// ── Estimate output size ────────────────────────────────────────────────────

app.post('/estimate', async (req, res) => {
  const { jobId, outputFormat: fmt, fps, width, dither, crf, codec, trimStart: tsRaw, trimEnd: teRaw } = req.body;
  const job = jobs.get(jobId);
  if (!job || !job.inputPath || !fs.existsSync(job.inputPath)) {
    return res.status(404).json({ error: 'Job not found or file missing' });
  }

  if (job.estimateProcess) {
    try { job.estimateProcess.kill('SIGKILL'); } catch {}
    job.estimateProcess = null;
  }

  const outputFormat = VALID_OUTPUT.includes(fmt) ? fmt : 'gif';
  const fullDuration = job.meta ? job.meta.duration : await getDuration(job.inputPath);
  const trimStart = tsRaw != null ? parseFloat(tsRaw) : 0;
  const trimEnd   = teRaw != null ? parseFloat(teRaw) : fullDuration;
  const trimDuration = Math.max(0.1, trimEnd - trimStart);

  const perSampleDur = Math.min(ESTIMATE_SAMPLE_DUR, trimDuration);
  let samplePoints;
  if (trimDuration <= perSampleDur * 2) {
    samplePoints = [trimStart];
  } else if (trimDuration < 15) {
    samplePoints = [trimStart + trimDuration * 0.33, trimStart + trimDuration * 0.67];
  } else {
    samplePoints = [trimStart + trimDuration * 0.2, trimStart + trimDuration * 0.5, trimStart + trimDuration * 0.8];
  }

  const samplePath = (i, ext) => path.join(TEMP_DIR, `${jobId}-est${i}.${ext}`);
  const cleanupAll = (paths) => paths.forEach(f => { try { fs.unlinkSync(f); } catch {} });

  const runEstFFmpegTo = (args, outPath) => new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', ...args]);
    job.estimateProcess = ff;
    let stderr = '';
    ff.stderr.on('data', c => { stderr = (stderr + c.toString()).slice(-1024); });
    ff.on('error', (err) => reject(err));
    const timer = setTimeout(() => { ff.kill('SIGKILL'); reject(new Error('estimate timeout')); }, ESTIMATE_TIMEOUT_MS);
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
      const palettePaths = samplePoints.map((_, i) => samplePath(i, 'png'));
      await Promise.all(samplePoints.map((start, i) =>
        runEstFFmpegTo(
          ['-ss', String(start), '-t', String(perSampleDur), '-i', job.inputPath,
           '-vf', `${scaleFilter},palettegen=stats_mode=full`, palettePaths[i]],
          palettePaths[i]
        )
      ));
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
    try { cleanupAll(samplePoints.flatMap((_, i) => [samplePath(i, outputFormat), samplePath(i, 'png'), samplePath(i, 'gif')])); } catch {}
    if (!err.message || err.message === 'estimate timeout' || err.message.includes('SIGKILL')) {
      return res.status(408).json({ error: 'Estimate timed out' });
    }
    res.status(500).json({ error: err.message });
  }
});

// ── Convert from a previously fetched/uploaded file ─────────────────────────

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
  if (job.conversionTimer) { clearTimeout(job.conversionTimer); job.conversionTimer = null; }

  res.json({ jobId });

  runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, { fps, width, dither, crf, codec, trimStart, trimEnd });
});

// ── Convert from uploaded file ──────────────────────────────────────────────

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

// ── Shared conversion logic ─────────────────────────────────────────────────

function runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, opts) {
  const rawStart  = opts.trimStart != null ? parseFloat(opts.trimStart) : null;
  const rawEnd    = opts.trimEnd   != null ? parseFloat(opts.trimEnd)   : null;
  const trimStart = rawStart != null && !isNaN(rawStart) ? rawStart : null;
  const trimEnd   = rawEnd   != null && !isNaN(rawEnd)   ? rawEnd   : null;
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
          ...trimArgs, '-i', inputPath,
          '-vf', `${scaleFilter},palettegen=stats_mode=full`, palettePath,
        ], (frame) => {
          const pct = 35 + Math.min(25, Math.round((frame / estFrames) * 25));
          broadcast(jobId, { status: 'pass1', progress: pct, message: `Pass 1: analysing frame ${frame}...` });
        });

        broadcast(jobId, { status: 'pass2', progress: 62, message: 'Pass 2: rendering GIF...' });

        await runFFmpeg([
          ...trimArgs, '-i', inputPath, '-i', palettePath,
          '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=${ditherVal}`, outputPath,
        ], (frame) => {
          const pct = 62 + Math.min(36, Math.round((frame / estFrames) * 36));
          broadcast(jobId, { status: 'pass2', progress: pct, message: `Pass 2: rendering frame ${frame}...` });
        });

        const outputSize = fs.statSync(outputPath).size;
        job.status = 'done';
        job.outputSize = outputSize;

        broadcast(jobId, {
          done: true, progress: 100, message: 'Done!',
          downloadUrl: `/download/${jobId}`, inputSize, outputSize, outputFormat,
        });

        job.conversionTimer = cleanup(jobId, CONVERSION_CLEANUP_MS);
      } catch (err) {
        console.error(err);
        broadcast(jobId, { error: true, message: err.message });
        cleanup(jobId, ERROR_CLEANUP_MS);
      }
    })();

  } else {
    // ── Video format: single-pass ──
    const w = opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(opts.width) || -1));
    const crfVal = Math.min(51, Math.max(0, parseInt(opts.crf) || 23));
    const codec = opts.codec || 'h264';
    const fpsOpt = opts.fps;

    const job = jobs.get(jobId);
    Object.assign(job, { status: 'queued', progress: 0, message: 'Starting...', outputPath, outputFormat });

    (async () => {
      try {
        const fullDuration = await getDuration(inputPath);
        const duration = trimDuration != null ? trimDuration : fullDuration;
        const estFrames = Math.max(1, Math.round(duration * 30));

        job.status = 'encoding';
        broadcast(jobId, { status: 'encoding', progress: 35, message: 'Encoding...' });

        const codecArgs = getCodecArgs(outputFormat, { crf: crfVal, codec, width: w, fps: fpsOpt });

        await runFFmpeg([
          ...trimArgs, '-i', inputPath, ...codecArgs, outputPath,
        ], (frame) => {
          const pct = 35 + Math.min(63, Math.round((frame / estFrames) * 63));
          broadcast(jobId, { status: 'encoding', progress: pct, message: `Encoding frame ${frame}...` });
        });

        const outputSize = fs.statSync(outputPath).size;
        job.status = 'done';
        job.outputSize = outputSize;

        broadcast(jobId, {
          done: true, progress: 100, message: 'Done!',
          downloadUrl: `/download/${jobId}`, inputSize, outputSize, outputFormat,
        });

        job.conversionTimer = cleanup(jobId, CONVERSION_CLEANUP_MS);
      } catch (err) {
        console.error(err);
        broadcast(jobId, { error: true, message: err.message });
        cleanup(jobId, ERROR_CLEANUP_MS);
      }
    })();
  }
}

// ── SSE progress stream ─────────────────────────────────────────────────────

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

  // Safety timeout — close stale SSE connections
  const sseTimer = setTimeout(() => res.end(), SSE_TIMEOUT_MS);

  req.on('close', () => {
    clearTimeout(sseTimer);
    const list = sseClients.get(jobId);
    if (!list) return;
    const idx = list.indexOf(res);
    if (idx !== -1) list.splice(idx, 1);
    if (list.length === 0) sseClients.delete(jobId);
  });
});

// ── File serving ────────────────────────────────────────────────────────────

app.get('/serve/:jobId',    (req, res) => serveJobFile(jobs, req, res, 'outputPath'));
app.get('/input/:jobId',    (req, res) => serveJobFile(jobs, req, res, 'inputPath'));
app.get('/download/:jobId', (req, res) => serveJobFile(jobs, req, res, 'outputPath', true));

// ── Expose output path for Electron native drag ────────────────────────────

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
