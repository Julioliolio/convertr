https://github.com/user-attachments/assets/ebc3f3be-08d0-4336-a07a-304caf0d1d61
# Convertr

A desktop app that converts video files between formats — GIF, MP4, WebM, MOV, AVI, MKV, MP3 — and can download & convert videos directly from URLs (YouTube, Twitter/X, etc.).

**[Try it in your browser →](https://julioliolio.github.io/convertr/app/)** No install; files are converted on your device and never uploaded. (URL downloads need the desktop app.)

---

## Download

Grab the latest installer from the **[Releases](https://github.com/Julioliolio/convertr/releases)** page.

| Platform | File |
|---|---|
| macOS (Apple Silicon) | `Convertr-x.x.x-arm64.dmg` |
| Windows | `Convertr-Setup-x.x.x.exe` |

---

## Installing

### macOS

1. Download the `.dmg`
2. Open it and drag **Convertr** into your Applications folder
3. Right-click the app → **Open** (one-time Gatekeeper workaround for unsigned apps)
4. Click **Open** in the security dialog

After that first launch, the app opens normally every time.

### Windows

1. Download and run the `.exe` installer
2. If you see "Windows protected your PC", click **More info** → **Run anyway**
3. Follow the installer — a shortcut is placed on your desktop

---

## Updates

The app updates itself automatically. When a new version is available it downloads in the background and shows a **"Restart to update"** prompt when ready — no manual reinstall needed.

---

## URL downloads (yt-dlp)

Fetching from YouTube, Twitter/X, and other sites uses **yt-dlp**. Nothing to install: Convertr downloads the official yt-dlp build on first launch, keeps it in your user data folder, and checks GitHub for a newer one once a day. If a download fails, it also checks right away, since YouTube regularly breaks older versions. It merges with the bundled FFmpeg and solves YouTube's JavaScript challenges with the app's own runtime, so you don't need a separate FFmpeg or Deno install.

A system-wide yt-dlp (`brew install yt-dlp` / `winget install yt-dlp.yt-dlp`) is only used as a fallback if the managed copy can't be downloaded, e.g. when offline on first launch.

---

## Online version

[julioliolio.github.io/convertr/app](https://julioliolio.github.io/convertr/app/) runs the same interface with [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm): FFmpeg compiled to WebAssembly, running in your browser. Differences from the desktop app:

- No URL downloads (yt-dlp can't run in a browser)
- Slower, since WebAssembly FFmpeg is single-threaded; best for short clips
- WebM output uses VP8 (VP9 crashes the WebAssembly build), and there's no H.265 option
- The first conversion downloads the ~32 MB FFmpeg core

It's built from the same source with `npm run build:web` and deployed by `.github/workflows/pages.yml` on every push to `main`.

---

## What It Does

- **Converts video files** between formats: GIF, MP4, WebM, MOV, AVI, MKV
- **Fetches from URLs** — paste a YouTube, Twitter/X, or other supported link to download and convert directly (yt-dlp is managed and kept up to date automatically)
- **Accepts a wide range of inputs**: MP4, MOV, AVI, MKV, WebM, FLV, WMV, GIF, M4V, TS, MTS, 3GP, OGV (up to 500 MB)
- **High-quality GIF export** using a 2-pass FFmpeg palette pipeline with selectable dithering algorithms
- **Video encoding controls**: H.264 / H.265 codec selection, CRF quality slider, resolution scaling
- **Real-time progress** streamed via Server-Sent Events
- **Self-cleaning**: temporary files deleted automatically after conversion

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Solid.js + TypeScript |
| Bundler | Vite |
| Backend | Node.js + Express |
| Desktop wrapper | Electron |
| Media processing | FFmpeg + FFprobe (bundled) |
| URL downloads | yt-dlp (auto-installed and updated) |
| Online version | ffmpeg.wasm |
| Auto-updates | electron-updater |
| Build | Electron Builder |

---

## Running Locally

```bash
# 1. Clone the repo
git clone https://github.com/Julioliolio/convertr.git
cd convertr

# 2. Install dependencies
npm install

# 3a. Start as a web server (http://localhost:3000)
npm start

# 3b. Start with hot-reload during development
npm run dev

# 3c. Launch as an Electron desktop app
npm run electron-dev

# 3d. Run the in-browser (GitHub Pages) version
npm run dev:web
```

Node.js v18+ is required. FFmpeg is bundled — no system install needed.

---

## Troubleshooting

**"Could not set up yt-dlp automatically" when fetching a URL**
Convertr couldn't download yt-dlp from GitHub. Check your connection and try again, or install it system-wide (`brew install yt-dlp` / `winget install yt-dlp.yt-dlp`) as a fallback.

**YouTube downloads fail with "HTTP Error 403" or similar**
YouTube changed something and yt-dlp needs an update. Convertr fetches the newest yt-dlp automatically and retries once. If it still fails, yt-dlp may not have released a fix yet; try again later.

**macOS: app won't open after right-click → Open**
Go to System Settings → Privacy & Security → scroll down → click **Open Anyway** next to the Convertr entry.

**Windows: installer blocked by antivirus**
The app spawns child processes for video conversion, which can trigger heuristic scanners. Add an exception for the install directory, or build from source.

**Port already in use (web server mode)**
Set a different port: `PORT=3001 npm start` (macOS/Linux) or `set PORT=3001 && npm start` (Windows).
