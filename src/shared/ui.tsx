import { Component, createEffect, on, onCleanup } from 'solid-js';
import { ACCENT, ACCENT_75, BG, MONO } from './tokens';
import { solveBezier } from './utils';
import type { JSX } from 'solid-js';

// ── SVG path constants (module-internal, used by the icons below) ───────────

// Play arm corners (79×86 viewBox, same as pause)
const PLAY_1  = "M47.405,46.646 L26.634,26.350 L30.787,22.292 L51.558,42.588 Z";
const PLAY_2  = "M30.794,62.878 L51.565,42.582 L47.411,38.524 L26.641,58.820 Z";
// Pause bars — point order matches play arms for a clean morph
const PAUSE_1 = "M27.294,62.272 L27.294,22.904 L33.099,22.904 L33.099,62.272 Z";
const PAUSE_2 = "M50.904,62.272 L50.904,22.904 L45.099,22.904 L45.099,62.272 Z";
// Chevron (used in FormatButton) — viewBox 28×44.
// Derived from the user-provided dropdown.svg: each rect's 4 corners, in the
// rect-local (0,0)→(w,0)→(w,h)→(0,h) winding order, pushed through the rect's
// matrix transform. Keeping that winding is what makes the per-point linear
// interpolation to the minus rect look like a clean fold, not a shear.
const CHEVRON_1 = "M22.1948,25.7462 L1.4312,5.4567 L5.5838,1.3984 L26.3474,21.6879 Z";
const CHEVRON_2 = "M5.58331,41.9784 L26.347,21.6889 L22.1943,17.6306 L1.4307,37.9201 Z";
// Minus targets (used in FormatButton when open) — a 26×5.8 horizontal bar
// centered vertically in the 28×44 viewBox. Corner order matches the chevron
// paths above so each chevron corner maps to the nearest minus corner:
// both arms fold flat onto the same bar, no crossing strokes mid-morph.
const MINUS_1   = "M27,24.9 L1,24.9 L1,19.1 L27,19.1 Z";
const MINUS_2   = "M1,24.9 L27,24.9 L27,19.1 L1,19.1 Z";

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
      <rect width="78.1985" height="85.1755" fill={ACCENT} />
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
    <rect width="78.198" height="87.165" fill={ACCENT} />
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
    <rect x="0" width="78.198" height="87.165" fill={ACCENT} />
    <path d="M64.984 43.583L43.739 64.796L39.49 60.553L53.481 46.582H0.009V40.582H53.481L39.49 26.613L43.739 22.37L64.984 43.583Z" fill="#FFFFFF" />
  </svg>
);

// ── Settings dial (toggles video settings panel), 20 × 22 ───────────────────
// Two visual states driven by `open`; silhouette is identical in both — only
// the fill inverts (positive vs negative of the same shape):
//   closed → white stroked ring with a white "hand" inside (empty dial)
//   open   → filled white disc with a pink "hand" subtracted from it
// Both states are drawn and crossfaded so the toggle doesn't feel sudden.
// On hover and on state change the hand sweeps 360° with a back.out
// overshoot — a "tuning" gesture. Both triggers use the Web Animations API
// (element.animate) so each call creates a fresh Animation instance — no
// CSS animation restart headaches.
const DIAL_SPIN_KEYFRAMES: Keyframe[] = [
  { transform: 'rotate(0deg)' },
  { transform: 'rotate(360deg)' },
];
const DIAL_SPIN_OPTS: KeyframeAnimationOptions = {
  duration: 540,
  easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)',  // back.out
};

export const SettingsSvg: Component<{ open?: boolean; width?: number; height?: number }> = (p) => {
  let svgRef!: SVGSVGElement;
  let lastSpinAt = 0;

  const triggerSpin = () => {
    if (!svgRef) return;
    const now = performance.now();
    // If a spin already fired within 0.5s, skip this one so a quick
    // hover → click doesn't double-fire. Spaced-out interactions each
    // get their own sweep.
    if (now - lastSpinAt < 500) return;
    lastSpinAt = now;
    svgRef.querySelectorAll('.settings-dial__hand').forEach(h =>
      (h as SVGElement).animate(DIAL_SPIN_KEYFRAMES, DIAL_SPIN_OPTS),
    );
  };

  // Spin on state change (skip the initial render).
  createEffect(on(() => p.open, triggerSpin, { defer: true }));

  return (
    <svg
      ref={svgRef!}
      class="settings-dial"
      onMouseEnter={triggerSpin}
      width={p.width ?? 20} height={p.height ?? 22}
      viewBox="0 0 79 88" fill="none" xmlns="http://www.w3.org/2000/svg"
      preserveAspectRatio="none"
      style={{ width: `${p.width ?? 20}px`, height: `${p.height ?? 22}px`, 'flex-shrink': '0' }}
    >
      <rect width="78.198" height="87.165" fill={ACCENT} />
      {/* Closed state — stroked ring with white hand inside */}
      <g class="settings-dial__state" style={{ opacity: p.open ? 0 : 1 }}>
        <circle cx="39.1" cy="43.6" r="22" fill="none" stroke="#FFFFFF" stroke-width="6.5" />
        <path class="settings-dial__hand" d="M39.1 43.6 L51.83 30.87" stroke="#FFFFFF" stroke-width="6.5" stroke-linecap="square" />
      </g>
      {/* Open state — filled disc with pink hand (subtractive) */}
      <g class="settings-dial__state" style={{ opacity: p.open ? 1 : 0 }}>
        <circle cx="39.1" cy="43.6" r="22" fill="#FFFFFF" />
        <path class="settings-dial__hand" d="M39.1 43.6 L51.83 30.87" stroke={ACCENT} stroke-width="6.5" stroke-linecap="square" />
      </g>
    </svg>
  );
};

// ── Chip: pink bg, cream text, IBM Plex Mono ─────────────────────────────────

// ── FormatButton: morphs chevron → minus when open ──────────────────────────

export const FormatButton: Component<{
  format: string; open: boolean; onClick: () => void;
  spring?: { dur: number; x1: number; y1: number; x2: number; y2: number };
  title?: string;
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
    return solveBezier(x1, y1, x2, y2, t);
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
      title={p.title}
      style={{
        position: 'relative',
        display: 'inline-flex', 'align-items': 'center', gap: '10px',
        padding: '2px 4px 2px 2px',
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
      {/* Dropdown glyph — 8×12 render of the 28×44 viewBox chevron.
          Fill-only (no stroke) so the arm thickness lands at ~1.6 px,
          close to the IBM Plex Mono 16 px stem width. */}
      <svg
        width={8} height={12}
        viewBox="0 0 28 44" fill="none" preserveAspectRatio="none"
        style={{ position: 'relative', 'z-index': '1', width: '8px', height: '12px', 'flex-shrink': '0', overflow: 'visible' }}
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

// ── Plus-cross icon: 20 × 20, two 2px bars ─────────────────────────────────
// `Cross` is the in-flow center cross (position: relative, flex-shrink: 0).
// `CornerCrosshair` is the absolutely-positioned bbox-corner variant that
// IdleView and EditorView place via a ref + imperative top/left.

const CROSS_ARM_V = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px',  height: '20px', background: ACCENT };
const CROSS_ARM_H = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px',  background: ACCENT };

export const Cross = () => (
  <div style={{ position: 'relative', 'flex-shrink': '0', width: '20px', height: '20px' }}>
    <div style={CROSS_ARM_V} />
    <div style={CROSS_ARM_H} />
  </div>
);

export const CornerCrosshair: Component<{ ref?: (el: HTMLDivElement) => void }> = (p) => (
  <div ref={p.ref} style={{ position: 'absolute', width: '20px', height: '20px' }}>
    <div style={CROSS_ARM_V} />
    <div style={CROSS_ARM_H} />
  </div>
);

// ── Guide line for the bounding box ─────────────────────────────────────────
// Direction 'v' → full-height 1px column, 'h' → full-width 1px row.

export const GuideLine: Component<{
  orientation: 'v' | 'h';
  ref?: (el: HTMLDivElement) => void;
}> = (p) => (
  <div
    ref={p.ref}
    style={p.orientation === 'v'
      ? { position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }
      : { position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }
    }
  />
);
