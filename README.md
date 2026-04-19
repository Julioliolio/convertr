# Convertr

A desktop app and local web server that converts video files between formats — GIF, MP4, WebM, MOV, AVI, MKV — and can download & convert videos directly from URLs (YouTube, Twitter/X, etc.).

Download a pre-built binary from the **[Releases](../../releases)** page, or run it locally by following the steps below.

---

## Prerequisites

You need three things installed before the app will work:

### 1. Node.js (v18 or higher)

Check if you already have it:
```bash
node --version
```

Install if needed:
- **macOS**: `brew install node` or download from [nodejs.org](https://nodejs.org)
- **Windows**: `winget install OpenJS.NodeJS` or download from [nodejs.org](https://nodejs.org)
- **Linux**: `sudo apt install nodejs npm` (Ubuntu/Debian) or use [nvm](https://github.com/nvm-sh/nvm)

---

### 2. FFmpeg

Used for all video conversion. Must be on your system `PATH`.

Check if you already have it:
```bash
ffmpeg -version
```

Install if needed:

```bash
# macOS
brew install ffmpeg

# Windows (pick one)
winget install Gyan.FFmpeg
choco install ffmpeg          # if you use Chocolatey

# Ubuntu / Debian
sudo apt install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg
```

> **Windows note:** After installing, open a new terminal window so the updated PATH takes effect. Verify with `ffmpeg -version`.

---

### 3. yt-dlp

Required only for the **"Fetch from URL"** feature (downloading from YouTube, Twitter/X, etc.). File upload and conversion works without it.

Check if you already have it:
```bash
yt-dlp --version
```

Install if needed:

```bash
# macOS
brew install yt-dlp

# Windows (pick one)
winget install yt-dlp.yt-dlp
choco install yt-dlp          # if you use Chocolatey

# Ubuntu / Debian
sudo apt install yt-dlp
# or install the latest version directly:
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Arch Linux
sudo pacman -S yt-dlp
```

> **Windows note:** After installing via winget/choco, open a new terminal and verify with `yt-dlp --version`. If not found, make sure `C:\Users\<you>\AppData\Local\Microsoft\WinGet\Packages` (or the choco bin path) is on your PATH.

---

## Running Locally

```bash
# 1. Clone the repo
git clone https://github.com/your-username/convertr.git
cd convertr

# 2. Install Node dependencies
npm install

# 3a. Start as a web server (opens at http://localhost:3000)
npm start

# 3b. Start with auto-reload during development
npm run dev

# 3c. Launch as an Electron desktop app
npm run electron-dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser (for `npm start` / `npm run dev`). The Electron mode opens its own window automatically.

---

## Building the Desktop App

Produces a distributable installer in the `dist/` folder:

```bash
npm run electron-build
```

Output by platform:
- **macOS** → `.dmg`
- **Windows** → `.exe` (NSIS installer)
- **Linux** → `.AppImage`

### Build requirements by platform

#### Windows

electron-builder extracts an archive that contains macOS symlinks. Windows blocks symlink creation for normal users by default, which causes the build to fail with `Cannot create symbolic link : A required privilege is not held by the client`.

**Fix: enable Developer Mode before building.**

1. Open **Settings** → **System** → **For developers**
2. Turn on **Developer Mode** and confirm
3. Open a new terminal (the privilege takes effect immediately — no reboot needed)
4. If you already hit the error, clear the corrupted cache first:
   ```powershell
   Remove-Item -Recurse -Force "$env:LOCALAPPDATA\electron-builder\Cache\winCodeSign"
   ```
5. Run `npm run electron-build`

Alternatively, you can run your terminal **as Administrator**, but Developer Mode is the cleaner one-time fix.

#### macOS

You need **Xcode Command Line Tools** installed. If you've already run `brew install` for anything, you almost certainly have them. If not:

```bash
xcode-select --install
```

A dialog will appear — click **Install** and wait for it to finish (~5 minutes). Then run the build.

No Apple Developer account is needed to build locally. The resulting `.dmg` will be unsigned, which means users will need to do the right-click → Open workaround on first launch (see [Installing the Pre-built App](#installing-the-pre-built-app) below).

#### Linux

No special setup beyond the prerequisites already listed. Run:

```bash
npm run electron-build
```

The output `.AppImage` is self-contained and runs on any modern Linux distro.

---

## Installing the Pre-built App

### macOS — Gatekeeper workaround

Because the app is not signed with an Apple Developer certificate, macOS will block it on first launch.

**One-time workaround:**

1. Download the `.dmg` and drag **Convertr** into your Applications folder
2. **Right-click** (or Control-click) the app icon → **Open**
3. Click **Open** in the security dialog that appears

After doing this once, the app opens normally every time.

### Windows — SmartScreen workaround

Because the app is not code-signed, Windows SmartScreen may show a warning on first launch.

**Workaround:**

1. Download and run the `.exe` installer
2. If you see "Windows protected your PC", click **More info**
3. Click **Run anyway**

---

## What It Does

- **Converts video files** between formats: GIF, MP4, WebM, MOV, AVI, MKV
- **Fetches from URLs** — paste a YouTube, Twitter/X, or other supported link to download and convert directly (requires yt-dlp)
- **Accepts a wide range of inputs**: MP4, MOV, AVI, MKV, WebM, FLV, WMV, GIF, M4V, TS, MTS, 3GP, OGV (up to 500 MB)
- **High-quality GIF export** using a 2-pass FFmpeg palette pipeline with selectable dithering algorithms (`sierra2_4a`, `bayer`, `floyd_steinberg`, none)
- **Video encoding controls**: H.264 / H.265 codec selection, CRF quality slider (0–51), resolution scaling
- **Real-time progress** streamed via Server-Sent Events (SSE)
- **Self-cleaning**: temporary files are deleted automatically 10 minutes after a conversion finishes, or on error
- **Two run modes**: standalone web server or packaged Electron desktop app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Solid.js + TypeScript |
| Bundler / dev server | Vite |
| Backend | Node.js + Express |
| Desktop wrapper | Electron |
| Media processing | FFmpeg + FFprobe |
| URL downloads | yt-dlp |
| File uploads | Multer |
| Build | Electron Builder |

---

## Troubleshooting

**"ffmpeg is not recognized" / conversion fails immediately**
FFmpeg is not on your PATH. Install it (see Prerequisites above) and open a new terminal window.

**"yt-dlp is not installed" when fetching a URL**
yt-dlp is not installed or not on your PATH. Install it (see Prerequisites above) and restart the app.

**Port 3000 already in use**
Something else is using port 3000. Either stop the other process, or the Electron app will pick a free port automatically. For the web server mode, set a different port: `PORT=3001 npm start` (macOS/Linux) or `set PORT=3001 && npm start` (Windows cmd).

**macOS: app won't open after right-click → Open**
Try: System Settings → Privacy & Security → scroll down → click **Open Anyway** next to the Convertr entry.

**Windows: installer blocked by antivirus**
The app uses FFmpeg and spawns child processes, which can trigger some heuristic scanners. Add an exception for the install directory, or build from source using `npm run electron-build`.
