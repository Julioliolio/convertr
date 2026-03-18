# MP4 to GIF Converter

A high-quality video converter that runs as both a web app and a native desktop app (via Electron). Upload a video, pick your output format and settings, and get a converted file back — all processed locally with FFmpeg.

---

## What It Does

- **Converts video files** between formats: GIF, MP4, WebM, MOV, AVI, MKV
- **Accepts a wide range of inputs**: MP4, MOV, AVI, MKV, WebM, FLV, WMV, GIF, M4V, TS, MTS, 3GP, OGV (up to 500 MB)
- **High-quality GIF export** using a 2-pass FFmpeg palette pipeline with selectable dithering algorithms (`sierra2_4a`, `bayer`, `floyd_steinberg`, none)
- **Video encoding controls**: H.264 / H.265 codec selection, CRF quality slider (0–51), resolution scaling
- **Real-time progress** streamed to the browser via Server-Sent Events (SSE)
- **Self-cleaning**: temporary files are deleted automatically after download
- **Two run modes**: standalone web server or packaged Electron desktop app

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js + Express |
| Desktop wrapper | Electron |
| Media processing | FFmpeg + FFprobe (system binaries) |
| File uploads | Multer |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Build | Electron Builder |

---

## Prerequisites

- **Node.js** v14 or higher
- **FFmpeg** (including `ffprobe`) installed and available on your system `PATH`

Install FFmpeg if you don't have it:

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install ffmpeg

# Windows (via Chocolatey)
choco install ffmpeg
```

---

## Running Locally

```bash
# 1. Install dependencies
npm install

# 2a. Start the web server (http://localhost:3000)
npm start

# 2b. Start with auto-reload during development
npm run dev

# 2c. Launch as an Electron desktop app
npm run electron-dev
```

### Build the desktop app

```bash
npm run electron-build
```

This produces a distributable installer (`.dmg` on macOS, `.exe` via NSIS on Windows, `.AppImage` on Linux) in the `dist/` folder.

---

## Releases (GitHub Actions)

Prebuilt installers for macOS, Windows, and Linux are published automatically via GitHub Actions.

**To publish a new release:**

```bash
git tag v1.0.0
git push origin v1.0.0
```

This triggers the [`release.yml`](.github/workflows/release.yml) workflow, which:

1. Builds the app in parallel on macOS, Windows, and Linux runners
2. Collects the `.dmg`, `.exe`, and `.AppImage` artifacts
3. Creates a GitHub Release and attaches all three installers automatically

Users can then download the right file for their platform from the **[Releases](../../releases)** page — no build step needed.