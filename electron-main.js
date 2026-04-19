const { app, BrowserWindow, ipcMain, nativeImage } = require('electron/main');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

let mainWindow;
let viteProcess;
let serverPort;

// ── Create a drag icon as NativeImage (required by startDrag on macOS) ──
let dragIcon;

function getDragIcon() {
  if (dragIcon) return dragIcon;
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  // Fill all pixels with RGBA(20, 0, 255, 180) using a Uint32Array view
  const uint32 = new Uint32Array(buf.buffer);
  uint32.fill(0xB4FF0014); // little-endian: R=0x14, G=0x00, B=0xFF, A=0xB4
  dragIcon = nativeImage.createFromBuffer(buf, { width: size, height: size });
  return dragIcon;
}

// Spawn Vite and return its actual URL by reading stdout
function startVite(port) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;

    const settle = (fn, val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(val);
    };

    // On Windows, .bin/vite is a .cmd shim that can't be spawned directly.
    // Spawn node with the vite.js entry point instead — no shell needed,
    // process.kill() hits Vite directly (not a cmd.exe wrapper), and stdout
    // is a clean pipe so picocolors disables ANSI codes.
    const [viteBin, viteArgs] = process.platform === 'win32'
      ? ['node', [path.join(__dirname, 'node_modules', 'vite', 'bin', 'vite.js')]]
      : [path.join(__dirname, 'node_modules', '.bin', 'vite'), []];

    viteProcess = spawn(viteBin, viteArgs, {
      cwd: __dirname,
      env: { ...process.env, VITE_SERVER_PORT: String(port) },
    });

    viteProcess.stdout.on('data', (data) => {
      const raw = data.toString();
      process.stdout.write('[vite] ' + raw);
      // Strip ANSI escape codes before matching — Vite v8 bolds the port
      // number which puts escape sequences inside the URL when stdout is a TTY.
      const text = raw.replace(/\x1b\[[0-9;]*m/g, '');
      // Vite prints: "  ➜  Local:   http://localhost:5173/"
      const match = text.match(/Local:\s+(http:\/\/localhost:\d+)/);
      if (match) settle(resolve, match[1]);
    });

    viteProcess.stderr.on('data', (data) => {
      process.stderr.write('[vite] ' + data.toString());
    });

    viteProcess.on('error', (err) => settle(reject, err));

    viteProcess.on('close', (code) => {
      if (!settled) {
        settle(reject, new Error(`Vite exited with code ${code}`));
      } else if (code !== 0) {
        console.error(`[vite] crashed after start (code ${code})`);
        mainWindow?.loadFile(path.join(__dirname, 'public-built', 'index.html'));
      }
    });

    timer = setTimeout(() => settle(reject, new Error('Vite did not start within 30s')), 30000);
  });
}

async function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 750,
    minWidth: 480,
    minHeight: 400,
    title: 'Convertr',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 12, y: 12 },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Never let the renderer open a second window or navigate away from the
  // app shell. Drag-out / download flows go through IPC, not real nav.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    const ok =
      targetUrl.startsWith('file://') ||
      targetUrl.startsWith('http://localhost:') ||
      targetUrl.startsWith('http://127.0.0.1:');
    if (!ok) event.preventDefault();
  });

  const isDev = !app.isPackaged;

  if (isDev) {
    try {
      const viteUrl = await startVite(port);
      console.log('[Convertr] Loading Vite at', viteUrl);
      mainWindow.loadURL(viteUrl);
    } catch (err) {
      console.error('[Convertr] Vite failed to start:', err.message);
      // Fall back to production build
      mainWindow.loadFile(path.join(__dirname, 'public-built', 'index.html'));
    }
  } else {
    mainWindow.loadFile(path.join(__dirname, 'public-built', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (viteProcess) viteProcess.kill();
  });
}

// ── Native file drag out of electron window ──
ipcMain.on('ondragstart', async (event, filePath) => {
  if (!app.isPackaged) console.log('[Convertr] ondragstart IPC received, path:', filePath);
  if (!filePath || !fs.existsSync(filePath)) {
    console.error('[Convertr] Drag failed: file not found at', filePath);
    return;
  }
  try {
    let icon;
    try {
      icon = nativeImage.createFromPath(filePath);
      if (icon && !icon.isEmpty()) {
        const size = icon.getSize();
        const maxDim = 128;
        if (size.width > maxDim || size.height > maxDim) {
          const scale = maxDim / Math.max(size.width, size.height);
          icon = icon.resize({
            width: Math.round(size.width * scale),
            height: Math.round(size.height * scale),
          });
        }
      }
    } catch { icon = null; }

    if (!icon || icon.isEmpty()) {
      try {
        icon = await nativeImage.createThumbnailFromPath(filePath, { width: 128, height: 128 });
      } catch { icon = null; }
    }

    if (!icon || icon.isEmpty()) icon = getDragIcon();

    event.sender.startDrag({ file: filePath, icon });
  } catch (err) {
    console.error('[Convertr] startDrag error:', err.message, err.stack);
  }
});

// ── Let renderer ask for the real file path of a job's output ──
ipcMain.handle('get-output-path', async (_event, jobId) => {
  try {
    const { getJobOutputPath } = require('./server');
    return getJobOutputPath(jobId);
  } catch (err) {
    console.error('[Convertr] get-output-path error:', err.message);
    return null;
  }
});

app.whenReady().then(() => {
  const { startServer } = require('./server');

  startServer(0).then((port) => {
    serverPort = port;
    createWindow(port);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(serverPort);
  });
});

app.on('window-all-closed', () => {
  if (viteProcess) viteProcess.kill();
  app.quit();
});

// Last-resort guards so an unhandled error from the spawned server, an SSE
// write after client disconnect, or a late-resolving ffprobe doesn't take
// the whole Electron process down with it.
process.on('uncaughtException', (err) => {
  console.error('[Convertr] uncaughtException:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Convertr] unhandledRejection:', reason);
});
