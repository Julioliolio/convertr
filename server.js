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

app.use(express.static(path.join(__dirname, 'public')));
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
  const { crf, codec, width } = opts;
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

  ytdlp.on('close', (code) => {
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
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'downloaded';
      job.inputPath = inputPath;
      job.inputSize = inputSize;
    }

    broadcast(jobId, {
      status: 'downloaded',
      progress: 30,
      message: 'Download complete. Ready to convert.',
      inputPath,
      inputSize,
      fileName: path.basename(inputPath),
    });
  });
});

// ── Convert from a previously fetched URL (uses inputPath from /fetch job) ──
app.post('/convert-fetched', async (req, res) => {
  const { jobId, outputFormat: fmt, fps, width, dither, crf, codec } = req.body;
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

  res.json({ jobId });

  runConversion(jobId, inputPath, inputSize, outputPath, outputFormat, { fps, width, dither, crf, codec });
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
  if (outputFormat === 'gif') {
    // ── GIF: 2-pass palette pipeline ──
    const fpsOriginal = opts.fps === 'original';
    const fps = fpsOriginal ? null : Math.min(60, Math.max(1, parseInt(opts.fps) || 15));
    const width = opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(opts.width) || 640));
    const ditherVal = ['sierra2_4a', 'bayer', 'floyd_steinberg', 'none'].includes(opts.dither)
      ? opts.dither : 'sierra2_4a';

    const palettePath = path.join(TEMP_DIR, `${jobId}-palette.png`);
    const fpsPart = fpsOriginal ? '' : `fps=${fps},`;
    const scaleFilter = width === -1
      ? `${fpsPart}scale=iw:-1:flags=lanczos`
      : `${fpsPart}scale=${width}:-1:flags=lanczos`;

    const job = jobs.get(jobId);
    Object.assign(job, { status: 'queued', progress: 0, message: 'Starting...', palettePath, outputPath, outputFormat });

    (async () => {
      try {
        const duration = await getDuration(inputPath);
        const estFrames = Math.max(1, Math.round(duration * (fps || 30)));

        job.status = 'pass1';
        broadcast(jobId, { status: 'pass1', progress: 35, message: 'Pass 1: building palette...' });

        await runFFmpeg([
          '-i', inputPath,
          '-vf', `${scaleFilter},palettegen=stats_mode=full`,
          palettePath,
        ], (frame) => {
          const pct = 35 + Math.min(25, Math.round((frame / estFrames) * 25));
          broadcast(jobId, { status: 'pass1', progress: pct, message: `Pass 1: analysing frame ${frame}...` });
        });

        broadcast(jobId, { status: 'pass2', progress: 62, message: 'Pass 2: rendering GIF...' });

        await runFFmpeg([
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

    const job = jobs.get(jobId);
    Object.assign(job, { status: 'queued', progress: 0, message: 'Starting...', outputPath, outputFormat });

    (async () => {
      try {
        const duration = await getDuration(inputPath);
        const estFrames = Math.max(1, Math.round(duration * 30));

        job.status = 'encoding';
        broadcast(jobId, { status: 'encoding', progress: 35, message: 'Encoding...' });

        const codecArgs = getCodecArgs(outputFormat, { crf, codec, width });

        await runFFmpeg([
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
