/** Format seconds as a short string, e.g. "12s" */
export const fmtDuration = (s: number) => `${Math.round(s)}s`;

/** Format byte count as a human-readable MB string */
export const fmtBytes = (bytes: number) => {
  const mb = bytes / 1_048_576;
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 10)  return mb.toFixed(1) + ' MB';
  return Math.round(mb) + ' MB';
};

/**
 * Extract N evenly-spaced thumbnail frames from a video source URL.
 * Returns an array of base64 data-URLs (JPEG, 0.8 quality).
 */
export const extractFrames = (src: string, duration: number, count: number): Promise<string[]> =>
  new Promise((resolve) => {
    const vid = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vid.src = src; vid.muted = true; vid.preload = 'auto';
    const results: string[] = [];
    let idx = 0; let thumbW = 24;
    const seekNext = () => { if (idx >= count) { resolve(results); return; } vid.currentTime = (idx / count) * duration + 0.01; };
    vid.addEventListener('seeked', () => { ctx.drawImage(vid, 0, 0, thumbW, 24); results.push(canvas.toDataURL('image/jpeg', 0.8)); idx++; seekNext(); });
    vid.addEventListener('loadedmetadata', () => { thumbW = Math.round(24 * vid.videoWidth / vid.videoHeight); canvas.width = thumbW; canvas.height = 24; seekNext(); });
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
// for path-morph easing and by the bezier-curve editor in SliderPlayground.

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
