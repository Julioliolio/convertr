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
      if (f && fs.existsSync(f)) {
        try { fs.unlinkSync(f); } catch {}
      }
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
      stderr += text;
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
function getCodecArgs(outputFormat, opts) {
  const { crf, codec, width } = opts;
  const scaleFilter = width === -1 ? null : `scale=${width}:-2`;

  switch (outputFormat) {
    case 'mp4': {
      const vcodec = codec === 'h265' ? 'libx265' : 'libx264';
      const args = ['-c:v', vcodec, '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
      if (scaleFilter) args.push('-vf', scaleFilter);
      return args;
    }
    case 'webm': {
      const args = ['-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-c:a', 'libopus', '-b:a', '128k'];
      if (scaleFilter) args.push('-vf', scaleFilter);
      return args;
    }
    case 'mov': {
      const args = ['-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
      if (scaleFilter) args.push('-vf', scaleFilter);
      return args;
    }
    case 'avi': {
      const args = ['-c:v', 'libx264', '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
      if (scaleFilter) args.push('-vf', scaleFilter);
      return args;
    }
    case 'mkv': {
      const vcodec = codec === 'h265' ? 'libx265' : 'libx264';
      const args = ['-c:v', vcodec, '-crf', String(crf), '-preset', 'medium', '-c:a', 'aac', '-b:a', '128k'];
      if (scaleFilter) args.push('-vf', scaleFilter);
      return args;
    }
    default:
      return ['-c:v', 'libx264', '-crf', '23', '-c:a', 'aac'];
  }
}

app.post('/convert', upload.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const outputFormat = VALID_OUTPUT.includes(req.body.outputFormat) ? req.body.outputFormat : 'gif';
  const jobId = uuidv4();
  const inputPath = req.file.path;
  const inputSize = req.file.size;
  const outputPath = path.join(TEMP_DIR, `${jobId}-output.${outputFormat}`);

  if (outputFormat === 'gif') {
    // ── GIF: 2-pass palette pipeline ──
    const fpsOriginal = req.body.fps === 'original';
    const fps = fpsOriginal ? null : Math.min(60, Math.max(1, parseInt(req.body.fps) || 15));
    const width = req.body.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(req.body.width) || 640));
    const dither = ['sierra2_4a', 'bayer', 'floyd_steinberg', 'none'].includes(req.body.dither)
      ? req.body.dither : 'sierra2_4a';

    const palettePath = path.join(TEMP_DIR, `${jobId}-palette.png`);
    const fpsPart = fpsOriginal ? '' : `fps=${fps},`;
    const scaleFilter = width === -1
      ? `${fpsPart}scale=iw:-1:flags=lanczos`
      : `${fpsPart}scale=${width}:-1:flags=lanczos`;

    jobs.set(jobId, { status: 'queued', progress: 0, message: 'Starting…', inputPath, palettePath, outputPath, inputSize, outputSize: 0, outputFormat });
    res.json({ jobId });

    (async () => {
      try {
        const duration = await getDuration(inputPath);
        const estFrames = Math.max(1, Math.round(duration * (fps || 30)));

        jobs.get(jobId).status = 'pass1';
        broadcast(jobId, { status: 'pass1', progress: 0, message: 'Pass 1: building palette…' });

        await runFFmpeg([
          '-i', inputPath,
          '-vf', `${scaleFilter},palettegen=stats_mode=full`,
          palettePath,
        ], (frame) => {
          const pct = Math.min(45, Math.round((frame / estFrames) * 45));
          broadcast(jobId, { status: 'pass1', progress: pct, message: `Pass 1: analysing frame ${frame}…` });
        });

        broadcast(jobId, { status: 'pass2', progress: 48, message: 'Pass 2: rendering GIF…' });

        await runFFmpeg([
          '-i', inputPath,
          '-i', palettePath,
          '-lavfi', `${scaleFilter} [x]; [x][1:v] paletteuse=dither=${dither}`,
          outputPath,
        ], (frame) => {
          const pct = 50 + Math.min(48, Math.round((frame / estFrames) * 48));
          broadcast(jobId, { status: 'pass2', progress: pct, message: `Pass 2: rendering frame ${frame}…` });
        });

        const outputSize = fs.statSync(outputPath).size;
        jobs.get(jobId).status = 'done';
        jobs.get(jobId).outputSize = outputSize;

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
    const width = req.body.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(req.body.width) || -1));
    const crf = Math.min(51, Math.max(0, parseInt(req.body.crf) || 23));
    const codec = req.body.codec || 'h264';

    jobs.set(jobId, { status: 'queued', progress: 0, message: 'Starting…', inputPath, outputPath, inputSize, outputSize: 0, outputFormat });
    res.json({ jobId });

    (async () => {
      try {
        const duration = await getDuration(inputPath);
        const estFrames = Math.max(1, Math.round(duration * 30));

        jobs.get(jobId).status = 'encoding';
        broadcast(jobId, { status: 'encoding', progress: 0, message: 'Encoding…' });

        const codecArgs = getCodecArgs(outputFormat, { crf, codec, width });

        await runFFmpeg([
          '-i', inputPath,
          ...codecArgs,
          outputPath,
        ], (frame) => {
          const pct = Math.min(98, Math.round((frame / estFrames) * 98));
          broadcast(jobId, { status: 'encoding', progress: pct, message: `Encoding frame ${frame}…` });
        });

        const outputSize = fs.statSync(outputPath).size;
        jobs.get(jobId).status = 'done';
        jobs.get(jobId).outputSize = outputSize;

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
});

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
    const list = sseClients.get(jobId) || [];
    const idx = list.indexOf(res);
    if (idx !== -1) list.splice(idx, 1);
  });
});

app.get('/download/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job || !fs.existsSync(job.outputPath)) return res.status(404).json({ error: 'Not found' });
  const ext = job.outputFormat || 'gif';
  res.download(job.outputPath, `converted.${ext}`, () => cleanup(req.params.jobId, 2000));
});

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

module.exports = { startServer };
