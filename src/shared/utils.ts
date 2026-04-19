import { Accessor, createSignal, onCleanup, onMount } from 'solid-js';

/** Format seconds as a short string, e.g. "12s" */
export const fmtDuration = (s: number) => `${Math.round(s)}s`;

/**
 * Smooths a target progress signal so the displayed value ramps continuously
 * at a max rate of 100/minDurationMs % per ms. Guarantees the visible 0→100
 * sweep takes at least `minDurationMs`, even if the source jumps.
 *
 * - target rises faster than rate → displayed lags, catches up smoothly
 * - target ≤ displayed (reset/cancel) → displayed snaps down even when inactive
 * - optional `active` gate:
 *   • inactive: ramping is paused; displayed holds at its current value
 *     (still snaps DOWN on a target reset so a new run starts from 0)
 *   • inactive → active transition: displayed resets to 0, so the next
 *     ramp begins from zero rather than carrying over from a prior run
 */
export function useSmoothedProgress(
  target: Accessor<number>,
  minDurationMs = 3000,
  active?: Accessor<boolean>,
): Accessor<number> {
  const maxRatePerMs = 100 / minDurationMs;
  const [displayed, setDisplayed] = createSignal(0);
  let wasActive = active ? active() : true;

  onMount(() => {
    let raf = 0;
    let lastT = performance.now();
    const tick = (now: number) => {
      const dt = now - lastT;
      lastT = now;
      const isActive = active ? active() : true;
      if (isActive && !wasActive) setDisplayed(0);
      wasActive = isActive;
      const t = target();
      const d = displayed();
      if (t <= d) {
        setDisplayed(t);
      } else if (isActive) {
        setDisplayed(Math.min(t, d + maxRatePerMs * dt));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(raf));
  });

  return displayed;
}

/** Format byte count as a human-readable MB string */
export const fmtBytes = (bytes: number) => {
  const mb = bytes / 1_048_576;
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 10)  return mb.toFixed(1) + ' MB';
  return Math.round(mb) + ' MB';
};

/** Render `v / of` as a percentage string with 4 decimal places. */
export const pct = (v: number, of: number) => (v / of * 100).toFixed(4) + '%';

/**
 * Extract N evenly-spaced thumbnail frames from a video source URL.
 * Returns an array of base64 data-URLs (JPEG, 0.8 quality).
 * Resolves with [] if the source can't be decoded (e.g. gif given to <video>).
 */
export const extractFrames = (src: string, duration: number, count: number): Promise<string[]> =>
  new Promise((resolve) => {
    const vid = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vid.src = src; vid.muted = true; vid.preload = 'auto';
    const results: string[] = [];
    let idx = 0; let thumbW = 24;
    let resolved = false;
    const finish = (out: string[]) => { if (resolved) return; resolved = true; resolve(out); };
    const seekNext = () => { if (idx >= count) { finish(results); return; } vid.currentTime = (idx / count) * duration + 0.01; };
    vid.addEventListener('seeked', () => { ctx.drawImage(vid, 0, 0, thumbW, 24); results.push(canvas.toDataURL('image/jpeg', 0.8)); idx++; seekNext(); });
    vid.addEventListener('loadedmetadata', () => {
      if (!vid.videoWidth || !vid.videoHeight) { finish([]); return; }
      thumbW = Math.round(24 * vid.videoWidth / vid.videoHeight);
      canvas.width = thumbW; canvas.height = 24;
      seekNext();
    });
    vid.addEventListener('error', () => finish([]));
  });

// ── Scramble text animation ───────────────────────────────────────────────────
// Animates one or more strings from random chars to a target string, left to right.
// Used by the EXPECTED SIZE chip, the format picker, and the dither tooltip.

export interface ScrambleTarget {
  target: string;
  setter: (v: string) => void;
}
export interface ScrambleOptions {
  frames?: number;       // total animation frames (default 14)
  frameMs?: number;      // ms between frames  (default 30)
  chars?: string;        // alphabet to pick random chars from
}

const DEFAULT_SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/**
 * Run a scramble animation. Returns the rAF id so callers can cancel.
 * Pass prevRaf (or 0) to cancel a previous run before starting.
 */
export function scrambleText(
  targets: ScrambleTarget[],
  prevRaf: number,
  opts: ScrambleOptions = {},
): number {
  cancelAnimationFrame(prevRaf);
  const totalFrames = opts.frames  ?? 14;
  const frameMs     = opts.frameMs ?? 30;
  const chars       = opts.chars   ?? DEFAULT_SCRAMBLE_CHARS;
  let frame = 0;
  let last = performance.now();
  let rafId = 0;
  const tick = (now: number) => {
    if (now - last < frameMs) { rafId = requestAnimationFrame(tick); return; }
    last = now;
    frame++;
    if (frame >= totalFrames) {
      for (const t of targets) t.setter(t.target);
      return;
    }
    for (const t of targets) {
      const resolved = Math.floor((frame / totalFrames) * t.target.length);
      t.setter(t.target.split('').map((ch, i) =>
        i < resolved ? ch : ch === ' ' ? ' ' : chars[Math.floor(Math.random() * chars.length)]
      ).join(''));
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
  return rafId;
}

// ── Cubic bezier solver ───────────────────────────────────────────────────────
// Maps t∈[0,1] through a cubic-bezier(x1,y1,x2,y2) curve. Used by FormatButton
// for path-morph easing.

export function solveBezier(x1: number, y1: number, x2: number, y2: number, t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  // Newton's method to find u where sampleX(u) = t
  let u = t;
  for (let i = 0; i < 8; i++) {
    const err = ((ax * u + bx) * u + cx) * u - t;
    if (Math.abs(err) < 1e-6) break;
    const d = (3 * ax * u + 2 * bx) * u + cx;
    if (Math.abs(d) < 1e-6) break;
    u -= err / d;
  }
  return ((ay * u + by) * u + cy) * u;
}
