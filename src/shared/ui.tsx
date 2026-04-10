import { Component, createEffect, onCleanup } from 'solid-js';
import { ACCENT, BG, MONO } from './tokens';
import type { JSX } from 'solid-js';

// ── SVG path constants ────────────────────────────────────────────────────────

// Play arm corners (79×86 viewBox, same as pause)
export const PLAY_1  = "M47.405,46.646 L26.634,26.350 L30.787,22.292 L51.558,42.588 Z";
export const PLAY_2  = "M30.794,62.878 L51.565,42.582 L47.411,38.524 L26.641,58.820 Z";
// Pause bars — point order matches play arms for a clean morph
export const PAUSE_1 = "M27.294,62.272 L27.294,22.904 L33.099,22.904 L33.099,62.272 Z";
export const PAUSE_2 = "M50.904,62.272 L50.904,22.904 L45.099,22.904 L45.099,62.272 Z";

// Chevron (used in FormatButton)
export const CHEVRON_1 = "M47.405,46.646 L26.647,26.352 L30.798,22.294 L51.556,42.588 Z";
export const CHEVRON_2 = "M30.794,62.878 L51.552,42.584 L47.401,38.526 L26.643,58.820 Z";
// Minus targets
export const MINUS_1   = "M59.5,45.9 L19.5,45.9 L19.5,40.1 L59.5,40.1 Z";
export const MINUS_2   = "M19.5,45.9 L59.5,45.9 L59.5,40.1 L19.5,40.1 Z";

// ── PlayPause icon (morphing play ↔ pause via rAF) ──────────────────────────

export const PlayPauseIcon: Component<{ playing: boolean; width?: number; height?: number }> = (p) => {
  let ref1!: SVGPathElement;
  let ref2!: SVGPathElement;
  let rafId = 0;
  let initialized = false;

  const nums  = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
  const build = (n: number[]) =>
    `M${n[0]},${n[1]} L${n[2]},${n[3]} L${n[4]},${n[5]} L${n[6]},${n[7]} Z`;
  const ease  = (t: number) => t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

  const PN1 = nums(PLAY_1),  PN2 = nums(PLAY_2);
  const AN1 = nums(PAUSE_1), AN2 = nums(PAUSE_2);

  const animateTo = (to1: number[], to2: number[]) => {
    cancelAnimationFrame(rafId);
    const f1 = nums(ref1.getAttribute('d')!);
    const f2 = nums(ref2.getAttribute('d')!);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = ease(Math.min(1, (now - t0) / 180));
      ref1.setAttribute('d', build(f1.map((v, i) => v + (to1[i] - v) * t)));
      ref2.setAttribute('d', build(f2.map((v, i) => v + (to2[i] - v) * t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  onCleanup(() => cancelAnimationFrame(rafId));

  createEffect(() => {
    const playing = p.playing;
    if (!initialized) {
      ref1.setAttribute('d', playing ? PAUSE_1 : PLAY_1);
      ref2.setAttribute('d', playing ? PAUSE_2 : PLAY_2);
      initialized = true;
    } else {
      animateTo(playing ? AN1 : PN1, playing ? AN2 : PN2);
    }
  });

  return (
    <svg
      width={p.width ?? 16} height={p.height ?? 16}
      viewBox="0 0 79 86" fill="none" preserveAspectRatio="none"
      style={{ width: `${p.width ?? 16}px`, height: `${p.height ?? 16}px`, 'flex-shrink': '0' }}
    >
      <rect width="78.1985" height="85.1755" fill="#FC036D" />
      <path ref={ref1!} fill="white" stroke="white" stroke-width="2" />
      <path ref={ref2!} fill="white" stroke="white" stroke-width="2" />
    </svg>
  );
};

// ── X button, 20 × 22 ────────────────────────────────────────────────────────

export const XSvg: Component<{ width?: number; height?: number }> = (p) => (
  <svg
    width={p.width ?? 20} height={p.height ?? 22}
    viewBox="0 0 79 88" fill="none" xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
    style={{ width: `${p.width ?? 20}px`, height: `${p.height ?? 22}px`, 'flex-shrink': '0' }}
  >
    <rect width="78.198" height="87.165" fill="#FC006D" />
    <rect width="55" height="6" transform="matrix(0.643 -0.766 -0.766 -0.643 23.721 66.577)" fill="#FFFFFF" />
    <rect width="55" height="6" transform="matrix(-0.643 -0.766 -0.766 0.643 59.074 62.721)" fill="#FFFFFF" />
  </svg>
);

// ── Right arrow (process / go), 20 × 22 ──────────────────────────────────────

export const ArrowSvg: Component<{ width?: number; height?: number }> = (p) => (
  <svg
    width={p.width ?? 20} height={p.height ?? 22}
    viewBox="0 0 79 88" fill="none" xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
    style={{ width: `${p.width ?? 20}px`, height: `${p.height ?? 22}px`, 'flex-shrink': '0' }}
  >
    <rect x="0" width="78.198" height="87.165" fill="#FC006D" />
    <path d="M64.984 43.583L43.739 64.796L39.49 60.553L53.481 46.582H0.009V40.582H53.481L39.49 26.613L43.739 22.37L64.984 43.583Z" fill="#FFFFFF" />
  </svg>
);

// ── Chip: pink bg, cream text, IBM Plex Mono ─────────────────────────────────

// ── FormatButton: morphs chevron → minus when open ──────────────────────────

export const FormatButton: Component<{
  format: string; open: boolean; onClick: () => void;
  spring?: { dur: number; x1: number; y1: number; x2: number; y2: number };
}> = (p) => {
  let ref1!: SVGPathElement;
  let ref2!: SVGPathElement;
  let rafId = 0;
  let initialized = false;

  const nums  = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
  const build = (n: number[]) =>
    `M${n[0]},${n[1]} L${n[2]},${n[3]} L${n[4]},${n[5]} L${n[6]},${n[7]} Z`;
  const ease = (t: number) => {
    const { x1 = 0.34, y1 = 1.56, x2 = 0.64, y2 = 1 } = p.spring ?? {};
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
    const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const solveCubic = (target: number) => {
      let u = target;
      for (let i = 0; i < 8; i++) {
        const x = ((ax * u + bx) * u + cx) * u - target;
        const dx = (3 * ax * u + 2 * bx) * u + cx;
        if (Math.abs(dx) < 1e-6) break;
        u -= x / dx;
      }
      return u;
    };
    if (t === 0) return 0;
    if (t === 1) return 1;
    const u = solveCubic(t);
    return ((ay * u + by) * u + cy) * u;
  };

  const CN1 = nums(CHEVRON_1), CN2 = nums(CHEVRON_2);
  const MN1 = nums(MINUS_1),   MN2 = nums(MINUS_2);

  const animateTo = (to1: number[], to2: number[]) => {
    cancelAnimationFrame(rafId);
    const f1 = nums(ref1.getAttribute('d')!);
    const f2 = nums(ref2.getAttribute('d')!);
    const t0 = performance.now();
    const durMs = (p.spring?.dur ?? 0.32) * 1000;
    const tick = (now: number) => {
      const t = ease(Math.min(1, (now - t0) / durMs));
      ref1.setAttribute('d', build(f1.map((v, i) => v + (to1[i] - v) * t)));
      ref2.setAttribute('d', build(f2.map((v, i) => v + (to2[i] - v) * t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  onCleanup(() => cancelAnimationFrame(rafId));

  createEffect(() => {
    const open = p.open;
    if (!initialized) {
      ref1.setAttribute('d', open ? MINUS_1 : CHEVRON_1);
      ref2.setAttribute('d', open ? MINUS_2 : CHEVRON_2);
      initialized = true;
    } else {
      animateTo(open ? MN1 : CN1, open ? MN2 : CN2);
    }
  });

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex', 'align-items': 'center', gap: '3px',
        padding: '2px',
        cursor: 'pointer', 'user-select': 'none',
      }}
      onClick={p.onClick}
    >
      <div style={{
        position: 'absolute', top: '0', right: '0', bottom: '0', left: '-20px',
        background: ACCENT,
        'clip-path': p.open ? 'inset(0 0 0 20px)' : 'inset(0 0 0 calc(100% - 18px))',
        transition: `clip-path ${(p.spring?.dur ?? 0.15) * 1000}ms cubic-bezier(${p.spring?.x1 ?? 0.15}, ${p.spring?.y1 ?? 1.01}, ${p.spring?.x2 ?? 0.35}, ${p.spring?.y2 ?? 1})`,
        'pointer-events': 'none',
      }} />
      <span style={{
        position: 'relative', 'z-index': '1',
        color: p.open ? BG : ACCENT,
        'font-family': MONO, 'font-size': '16px', 'line-height': '16px',
        'flex-shrink': '0',
        transition: 'color 200ms ease-in-out',
      }}>
        {p.format}
      </span>
      <svg
        width={16} height={16}
        viewBox="0 0 79 86" fill="none" preserveAspectRatio="none"
        style={{ position: 'relative', 'z-index': '1', width: '16px', height: '16px', 'flex-shrink': '0' }}
      >
        <path ref={ref1!} fill={BG} style={{ transition: `fill ${(p.spring?.dur ?? 0.15) * 1000}ms ease-in-out` }} />
        <path ref={ref2!} fill={BG} style={{ transition: `fill ${(p.spring?.dur ?? 0.15) * 1000}ms ease-in-out` }} />
      </svg>
    </div>
  );
};

// ── Chip: pink bg, cream text, IBM Plex Mono ─────────────────────────────────

export const Chip = (p: { children: JSX.Element; size?: 'base' | 'xs' }) => (
  <span style={{
    display: 'inline-block', background: ACCENT, width: 'fit-content',
    'font-family': MONO,
    'font-size':   p.size === 'xs' ? '12px' : '16px',
    'line-height': p.size === 'xs' ? '16px' : '20px',
    color: BG, 'white-space': 'nowrap',
  }}>
    {p.children}
  </span>
);

// ── Plus cross icon: 20 × 20, two 2px bars ──────────────────────────────────

export const Cross = () => (
  <div style={{ position: 'relative', 'flex-shrink': '0', width: '20px', height: '20px' }}>
    <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
    <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
  </div>
);
