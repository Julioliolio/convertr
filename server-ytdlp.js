const path = require('path');
const fs = require('fs');
const os = require('os');

// YouTube changes its player every few weeks and older yt-dlp builds start
// failing (HTTP 403 mid-download, missing formats). System installs from
// winget / brew lag behind, so Convertr keeps its own copy of the official
// standalone build in a per-user data dir and refreshes it from GitHub. A
// yt-dlp on PATH is only used when the managed copy can't be downloaded
// (e.g. offline on first run).

const RELEASES_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const LATEST_DOWNLOAD = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // routine check: once a day
const FORCE_INTERVAL_MS = 10 * 60 * 1000;      // failure-triggered check: at most every 10 min
const HEADERS = { 'User-Agent': 'Convertr', Accept: 'application/vnd.github+json' };

// Electron sets CONVERTR_DATA_DIR to app.getPath('userData'); plain `node
// server.js` falls back to ~/.convertr. Read lazily so the env var can be
// set any time before the first fetch.
function binDir() {
  return path.join(process.env.CONVERTR_DATA_DIR || path.join(os.homedir(), '.convertr'), 'bin');
}
function managedPath() {
  return path.join(binDir(), process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
}
function statePath() {
  return path.join(binDir(), 'yt-dlp.json');
}

// Official standalone asset for this platform, or null if there isn't one
// (then we rely on a system install).
function assetName() {
  const { platform, arch } = process;
  if (platform === 'win32')  return arch === 'arm64' ? 'yt-dlp_arm64.exe' : 'yt-dlp.exe';
  if (platform === 'darwin') return 'yt-dlp_macos';
  if (platform === 'linux')  return arch === 'x64' ? 'yt-dlp_linux' : arch === 'arm64' ? 'yt-dlp_linux_aarch64' : null;
  return null;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(statePath(), 'utf8')); } catch { return {}; }
}
function writeState(state) {
  try { fs.writeFileSync(statePath(), JSON.stringify(state)); } catch {}
}

// Download to a temp file then rename, so a half-written binary is never run.
// On Windows the rename fails if the old exe is mid-download for another job;
// the caller keeps the old copy and retries on the next check.
async function downloadTo(url, dest) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Convertr' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${url}`);
  const tmp = `${dest}.download`;
  fs.writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  if (process.platform !== 'win32') fs.chmodSync(tmp, 0o755);
  try {
    fs.renameSync(tmp, dest);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

let inflight = null;
let lastForcedAt = 0;

// Install the managed binary if missing, or replace it if GitHub has a newer
// release. Never rejects; resolves true when a new build was installed.
// `force` skips the once-a-day gate (used after a failed download).
function update({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    const asset = assetName();
    if (!asset) return false;
    const bin = managedPath();
    const have = fs.existsSync(bin);
    const state = readState();

    if (have) {
      const now = Date.now();
      if (force) {
        if (now - lastForcedAt < FORCE_INTERVAL_MS) return false;
        lastForcedAt = now;
      } else if (state.checkedAt && now - state.checkedAt < CHECK_INTERVAL_MS) {
        return false;
      }
    }

    try {
      fs.mkdirSync(binDir(), { recursive: true });
      let release = null;
      try {
        const res = await fetch(RELEASES_API, { headers: HEADERS });
        if (res.ok) release = await res.json();
      } catch { /* fall through */ }

      if (!release) {
        // API unreachable or rate-limited. With a working copy, try again
        // later; without one, grab whatever "latest" redirects to.
        if (have) return false;
        await downloadTo(LATEST_DOWNLOAD + asset, bin);
        writeState({ version: null, checkedAt: Date.now() });
        console.log('[yt-dlp] installed latest (version unknown)');
        return true;
      }

      const latest = release.tag_name;
      if (have && latest === state.version) {
        writeState({ ...state, checkedAt: Date.now() });
        return false;
      }
      const match = (release.assets || []).find(a => a.name === asset);
      if (!match) throw new Error(`release ${latest} has no ${asset}`);
      await downloadTo(match.browser_download_url, bin);
      writeState({ version: latest, checkedAt: Date.now() });
      console.log(`[yt-dlp] installed ${latest}`);
      return true;
    } catch (err) {
      console.error('[yt-dlp] update failed:', err.message);
      return false;
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

// Which yt-dlp to run. `managed` tells the caller it's a current official
// build, so newer flags (e.g. --js-runtimes) are safe to pass.
async function resolveYtdlp() {
  await update();
  const bin = managedPath();
  return fs.existsSync(bin) ? { bin, managed: true } : { bin: 'yt-dlp', managed: false };
}

module.exports = { resolveYtdlp, updateYtdlp: update };
