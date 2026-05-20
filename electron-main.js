const { app, BrowserWindow, ipcMain, nativeImage, dialog, shell } = require('electron/main');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

// GPU rasterization must be set before app is ready
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

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
    mainWindow.loadURL(`http://localhost:${port}/`);
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

function isNewerVersion(remote, local) {
  const parse = (v) => v.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const r = parse(remote);
  const l = parse(local);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rn = r[i] || 0;
    const ln = l[i] || 0;
    if (rn !== ln) return rn > ln;
  }
  return false;
}

// Pick the release asset that matches the current platform. Linux uses AppImage
// (no real installer flow — we just reveal the file). Returns null if the
// release doesn't have a matching artifact.
function pickPlatformAsset(release, version) {
  const name =
    process.platform === 'darwin' ? `Convertr-${version}-mac.dmg`
  : process.platform === 'win32'  ? `Convertr-${version}-windows.exe`
  : process.platform === 'linux'  ? `Convertr-${version}-linux.AppImage`
  : null;
  if (!name) return null;
  return (release.assets || []).find((a) => a.name === name) || null;
}

// Download an asset to the OS Downloads folder using the main window's session
// so dock / taskbar progress works automatically. Resolves with the saved path.
function downloadAsset(asset) {
  return new Promise((resolve, reject) => {
    const win = mainWindow;
    if (!win) return reject(new Error('No window to host the download'));
    const ses = win.webContents.session;
    const savePath = path.join(app.getPath('downloads'), asset.name);
    const onWillDownload = (_event, item) => {
      item.setSavePath(savePath);
      item.on('updated', (_e, state) => {
        if (state !== 'progressing') return;
        const total = item.getTotalBytes();
        const got = item.getReceivedBytes();
        win.setProgressBar(total > 0 ? got / total : 2); // 2 = indeterminate
      });
      item.once('done', (_e, state) => {
        win.setProgressBar(-1);
        if (state === 'completed') resolve(savePath);
        else reject(new Error(`Download ${state}`));
      });
    };
    ses.once('will-download', onWillDownload);
    ses.downloadURL(asset.browser_download_url);
  });
}

async function checkForUpdate() {
  if (!app.isPackaged) return;
  try {
    const res = await fetch('https://api.github.com/repos/Julioliolio/convertr/releases/latest', {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Convertr' },
    });
    if (!res.ok) return;
    const data = await res.json();
    const remote = (data.tag_name || '').replace(/^v/, '');
    const local = app.getVersion();
    if (!remote || !isNewerVersion(remote, local)) return;

    const asset = pickPlatformAsset(data, remote);
    const releaseUrl = data.html_url || 'https://github.com/Julioliolio/convertr/releases/latest';

    // No matching artifact for this platform → fall back to opening the page.
    if (!asset) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `Convertr ${remote} is available`,
        detail: `You're running ${local}. Open the download page?`,
        buttons: ['Open Page', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) shell.openExternal(releaseUrl);
      return;
    }

    const { response: confirm } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `Convertr ${remote} is available`,
      detail: `You're running ${local}. Download and open the installer now?`,
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (confirm !== 0) return;

    let savedPath;
    try {
      savedPath = await downloadAsset(asset);
    } catch (err) {
      console.error('[Convertr] update download failed:', err.message);
      const { response: r } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Download failed',
        message: 'Could not download the update.',
        detail: `${err.message}\n\nOpen the release page instead?`,
        buttons: ['Open Page', 'Cancel'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r === 0) shell.openExternal(releaseUrl);
      return;
    }

    // Linux: no installer; just point the user at the new AppImage. The user
    // replaces their old AppImage manually — there's no equivalent of "mount
    // the DMG and drag over Applications" we can automate.
    if (process.platform === 'linux') {
      const { response: r } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update downloaded',
        message: `Convertr ${remote} is in your Downloads folder`,
        detail: 'Replace your existing AppImage with the new one to update.',
        buttons: ['Show in Folder', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (r === 0) shell.showItemInFolder(savedPath);
      return;
    }

    // macOS / Windows: open the installer and quit so the user can replace the
    // running app. Finder / the installer would refuse to overwrite a running
    // app, so quitting first is the right thing to do — the user already opted
    // into "update now" by getting this far.
    const installLabel = process.platform === 'darwin' ? 'Open Installer' : 'Run Installer';
    const installDetail = process.platform === 'darwin'
      ? 'Convertr will quit and the installer DMG will open. Drag the new Convertr onto Applications to finish.'
      : 'Convertr will quit and the installer will run.';
    const { response: r } = await dialog.showMessageBox({
      type: 'info',
      title: 'Update downloaded',
      message: `Convertr ${remote} is ready to install`,
      detail: installDetail,
      buttons: [installLabel, 'Show in Folder', 'Later'],
      defaultId: 0,
      cancelId: 2,
    });
    if (r === 0) {
      await shell.openPath(savedPath);
      app.quit();
    } else if (r === 1) {
      shell.showItemInFolder(savedPath);
    }
  } catch (err) {
    console.error('[Convertr] update check failed:', err.message);
  }
}

app.whenReady().then(() => {
  const { startServer } = require('./server');

  startServer(0).then((port) => {
    serverPort = port;
    createWindow(port);
    checkForUpdate();
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
