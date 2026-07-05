
<video src="'/Users/julioliolio/Desktop/videos converter/converter full (small).mp4'" width="320" height="240" controls></video>

or

<iframe width="560" height="315" src="https://www.youtube.com/embed/video-id" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

# Convertr

A desktop app that converts video files between formats — GIF, MP4, WebM, MOV, AVI, MKV — and can download & convert videos directly from URLs (YouTube, Twitter/X, etc.).

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

Fetching from YouTube, Twitter/X, and other sites requires **yt-dlp** to be installed separately. File uploads and local conversions work without it.

```bash
# macOS
brew install yt-dlp

# Windows
winget install yt-dlp.yt-dlp
```

The app will show a clear error message if a URL fetch is attempted without yt-dlp installed.

---

## What It Does

- **Converts video files** between formats: GIF, MP4, WebM, MOV, AVI, MKV
- **Fetches from URLs** — paste a YouTube, Twitter/X, or other supported link to download and convert directly (requires yt-dlp)
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
| URL downloads | yt-dlp |
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
```

Node.js v18+ is required. FFmpeg is bundled — no system install needed.

---

## Troubleshooting

**"yt-dlp is not installed" when fetching a URL**
Install yt-dlp (see above) and restart the app.

**macOS: app won't open after right-click → Open**
Go to System Settings → Privacy & Security → scroll down → click **Open Anyway** next to the Convertr entry.

**Windows: installer blocked by antivirus**
The app spawns child processes for video conversion, which can trigger heuristic scanners. Add an exception for the install directory, or build from source.

**Port already in use (web server mode)**
Set a different port: `PORT=3001 npm start` (macOS/Linux) or `set PORT=3001 && npm start` (Windows).
