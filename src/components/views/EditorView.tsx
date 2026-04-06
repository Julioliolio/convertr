import { Component, createEffect, createSignal, For, onCleanup, onMount, Show, untrack } from 'solid-js';
import { createDialKit } from 'dialkit/solid';
import type { VideoInfo } from '../../App';

// ── Design tokens (exact from Paper) ──────────────────────────────────────────
const ACCENT    = '#FC006D';
const ACCENT_75 = 'rgba(252,0,109,0.75)';
const BG        = '#F8F7F6';
const MONO      = "'IBM Plex Mono', system-ui, monospace";

const IDLE_GL = '18.1%'; const IDLE_GR = '81.9%';
const IDLE_GT = '31.2%'; const IDLE_GB = '68.8%';

const FORMATS = ['GIF', 'AVIF', 'MP4', 'MOV', 'WEBM', 'MKV'];

const pct = (v: number, of: number) => (v / of * 100).toFixed(4) + '%';

// Top bar height: 24px top padding + 22px tallest button (XSvg) + 24px bottom padding
const TOP_BAR_H_PX = 70;

// Space reserved for "VIDEO SETTINGS" label so it never clips off-screen.
// Landscape: label sits below video → reserve vertical space (24px gap + 20px text).
// Portrait:  label sits right of video → reserve horizontal space (24px gap + ~136px text).
const SETTINGS_RESERVE_H = 44;
const SETTINGS_RESERVE_W = 160;

// ── Types ──────────────────────────────────────────────────────────────────────
interface LayoutCfg {
  PAD_H: number;
  PAD_V: number;
}

interface BoxResult {
  left: number; top: number; right: number; bottom: number;
  isLandscape: boolean;
  gl: string; gr: string; gt: string; gb: string;
  topBarTopPct: string; topBarHPct: string;
  settingsTop: string; settingsLeft: string;
}

interface TransitionSet {
  vLines: string; hLines: string; crosses: string;
  bbox: string; topBar: string;
}

// ── Layout computation ─────────────────────────────────────────────────────────
// extraTopPx: additional px to cut from the video top (for open dropdown).
// The video scale/width/bottom are unchanged — only the top shifts down, cropping the video.
function computeBox(vw: number, vh: number, videoW: number, videoH: number, cfg: LayoutCfg, extraTopPx = 0): BoxResult {
  const isLandscape = videoW >= videoH;
  const padH    = vw * cfg.PAD_H;
  const padV    = vh * cfg.PAD_V;
  const topBarH = TOP_BAR_H_PX;
  const availW  = vw - 2 * padH - (isLandscape ? 0 : SETTINGS_RESERVE_W);
  const availH  = vh - 2 * padV - topBarH - (isLandscape ? SETTINGS_RESERVE_H : 0);
  const scale   = Math.min(availW / videoW, availH / videoH);
  const boxW    = videoW * scale;
  const boxH    = videoH * scale;
  const left    = (vw - boxW) / 2;
  // Natural (closed) positions
  const naturalTop    = padV + topBarH + (availH - boxH) / 2;
  const naturalBottom = naturalTop + boxH;
  // Open: top shifts down by extraTopPx, bottom stays fixed → video appears cut from top
  const top    = naturalTop + extraTopPx;
  const bottom = naturalBottom;
  const right  = left + boxW;
  const topBarTop        = naturalTop - topBarH;          // always padV + (availH-boxH)/2
  const effectiveTopBarH = topBarH + extraTopPx;          // expands to include dropdown area
  const settingsTop  = isLandscape ? pct(bottom + 24, vh) : pct(top + 24, vh);
  const settingsLeft = isLandscape ? pct(left + 24, vw)  : pct(right + 24, vw);
  return {
    left, top, right, bottom, isLandscape,
    gl: pct(left,  vw), gr: pct(right,  vw),
    gt: pct(top,   vh), gb: pct(bottom, vh),
    topBarTopPct: pct(topBarTop,        vh),
    topBarHPct:   pct(effectiveTopBarH, vh),
    settingsTop, settingsLeft,
  };
}

// ── SVG Icons (exact from Paper) ───────────────────────────────────────────────

// Right-pointing chevron (used for GIF > and play button), 16 × 16
const ChevronSvg: Component<{ width?: number; height?: number }> = (p) => (
  <svg
    width={p.width ?? 16} height={p.height ?? 16}
    viewBox="0 0 79 86" fill="none" xmlns="http://www.w3.org/2000/svg"
    preserveAspectRatio="none"
    style={{ width: `${p.width ?? 16}px`, height: `${p.height ?? 16}px`, 'flex-shrink': '0' }}
  >
    <rect width="78.198" height="85.175" fill="#FC036D" />
    <rect width="29.032" height="5.806" transform="matrix(-0.715 -0.699 0.715 -0.699 47.405 46.646)" fill="#F8F7F6" />
    <rect width="29.032" height="5.806" transform="matrix(0.715 -0.699 -0.715 -0.699 30.794 62.878)" fill="#F8F7F6" />
  </svg>
);

// X button, 20 × 22
const XSvg: Component<{ width?: number; height?: number }> = (p) => (
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

// Right arrow (process / go), 20 × 22
const ArrowSvg: Component<{ width?: number; height?: number }> = (p) => (
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

// ── Sub-components (exact from Paper) ─────────────────────────────────────────

// Chip: pink bg, cream text, IBM Plex Mono, text-base (16px/20px lh), no padding
const Chip = (p: { children: any; size?: 'base' | 'xs' }) => (
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

// Plus cross icon: 20 × 20, two 2px bars
const Cross = () => (
  <div style={{ position: 'relative', 'flex-shrink': '0', width: '20px', height: '20px' }}>
    <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
    <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
  </div>
);

const FormatButtonClosed: Component<{ format: string; onClick: () => void }> = (p) => (
  <div
    style={{ display: 'flex', 'align-items': 'center', gap: '4px', cursor: 'pointer', 'user-select': 'none' }}
    onClick={p.onClick}
  >
    <span style={{ color: ACCENT, 'font-family': MONO, 'font-size': '16px', 'line-height': '20px', 'flex-shrink': '0' }}>
      {p.format}
    </span>
    <ChevronSvg width={16} height={16} />
  </div>
);

const FormatButtonOpen: Component<{ format: string; onClick: () => void }> = (p) => (
  <div
    style={{ display: 'flex', 'align-items': 'center', cursor: 'pointer', 'user-select': 'none' }}
    onClick={p.onClick}
  >
    {/* "GIF" text with absolute pink bg block behind it */}
    <div style={{ position: 'relative', padding: '0 2px' }}>
      <div style={{ position: 'absolute', left: '0', top: '2px', width: '33px', height: '16px', background: ACCENT }} />
      <span style={{ position: 'relative', color: BG, 'font-family': MONO, 'font-size': '16px', 'line-height': '20px', 'flex-shrink': '0' }}>
        {p.format}
      </span>
    </div>
    {/* Dash / open indicator: pink bg box with white horizontal line */}
    <div style={{
      background: ACCENT, 'padding-inline': '3px', 'padding-block': '4px',
      display: 'flex', 'align-items': 'center', 'justify-content': 'center',
    }}>
      <div style={{ width: '7.97px', height: '8px', position: 'relative', 'flex-shrink': '0' }}>
        <div style={{
          position: 'absolute',
          left: 'calc(50% - 0.015px)', top: '50%',
          width: '1.5px', height: '5.9px',
          background: BG,
          'transform-origin': 'top left',
          transform: 'translate(-50%, -50%) rotate(90deg)',
        }} />
      </div>
    </div>
  </div>
);

// Timeline placeholder (exact structure from Paper)
const Timeline = () => (
  <div style={{ display: 'flex', 'align-items': 'center', gap: '4px', 'align-self': 'stretch', height: '24px', 'flex-shrink': '0' }}>
    <div style={{
      overflow: 'hidden', height: '24px', flex: '1', position: 'relative',
      background: BG, outline: `1px solid ${ACCENT}`,
    }}>
      {/* Left trim handle */}
      <div style={{ position: 'absolute', left: '0', top: '0', display: 'flex', 'align-items': 'center' }}>
        <div style={{ width: '6px', height: '25px', background: ACCENT, 'flex-shrink': '0' }} />
        <div style={{ position: 'absolute', left: '2px', top: '7px', width: '2px', height: '10px', background: '#F2F4F9' }} />
      </div>
      {/* Right trim handle (~97% from left) */}
      <div style={{ position: 'absolute', left: 'calc(100% - 6px)', top: '0', display: 'flex', 'align-items': 'center' }}>
        <div style={{ width: '6px', height: '32px', background: ACCENT, 'flex-shrink': '0' }} />
        <div style={{ position: 'absolute', left: '2px', top: '7px', width: '2px', height: '10px', background: '#F2F4F9' }} />
      </div>
      {/* Playhead scrubber (~23% from left) */}
      <div style={{ position: 'absolute', left: '23%', top: '0', width: '1px', height: '32px', background: ACCENT }} />
    </div>
  </div>
);

// ── Component ──────────────────────────────────────────────────────────────────
const EditorView: Component<{ video: VideoInfo; onBack: () => void }> = (props) => {
  let containerRef!: HTMLDivElement;
  let vLineL!: HTMLDivElement, vLineR!: HTMLDivElement;
  let hLineT!: HTMLDivElement, hLineB!: HTMLDivElement;
  let crossTL!: HTMLDivElement, crossTR!: HTMLDivElement;
  let crossBL!: HTMLDivElement, crossBR!: HTMLDivElement;
  let bboxEl!:     HTMLDivElement;
  let topBarEl!:   HTMLDivElement;
  let settingsEl!: HTMLDivElement;

  // ── Dials ────────────────────────────────────────────────────────────────────
  const layout = createDialKit('Layout', {
    PAD_H: [0.04, 0.005, 0.20, 0.005],
    PAD_V: [0.05, 0.01,  0.20, 0.005],
  });

  const anim = createDialKit('Animation', {
    timing: {
      p1_dur:     [0.35, 0.05, 3.0, 0.05],
      p2_dur:     [0.35, 0.05, 3.0, 0.05],
      p2_delay:   [0.35, 0.0,  2.0, 0.05],
      fade_dur:   [0.25, 0.05, 2.0, 0.05],
      fade_delay: [0.55, 0.0,  2.0, 0.05],
    },
    easing: {
      x1: [1.0,   0.0,  1.0, 0.01],
      y1: [-0.35, -1.0, 2.0, 0.01],
      x2: [0.22,  0.0,  1.0, 0.01],
      y2: [1.15,  -1.0, 2.0, 0.01],
    },
    dropdown: {
      dur: [0.3, 0.05, 3.0, 0.05],
    },
    enter:            { type: 'action' as const },
    exit:             { type: 'action' as const },
    open_dropdown:    { type: 'action' as const },
    close_dropdown:   { type: 'action' as const },
  }, {
    onAction: (path) => {
      if (path === 'enter')           triggerEnter();
      if (path === 'exit')            triggerExit();
      if (path === 'open_dropdown')   setFmtOpen(true);
      if (path === 'close_dropdown')  setFmtOpen(false);
    },
  });

  // ── State ────────────────────────────────────────────────────────────────────
  const [box,           setBox]           = createSignal<BoxResult | null>(null);
  const [vp,            setVp]            = createSignal({ vw: 0, vh: 0 });
  const [fmtOpen,       setFmtOpen]       = createSignal(false);
  const [format,        setFormat]        = createSignal(FORMATS[0]);
  const [displayFormat, setDisplayFormat] = createSignal(FORMATS[0]);

  // ── Scramble animation ────────────────────────────────────────────────────────
  const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let scrambleTimer: ReturnType<typeof setTimeout> | null = null;
  const scramble = (target: string) => {
    if (scrambleTimer != null) clearTimeout(scrambleTimer);
    const totalFrames = 14;
    const frameMs = 35;
    let frame = 0;
    const tick = () => {
      frame++;
      if (frame >= totalFrames) { setDisplayFormat(target); return; }
      const resolved = Math.floor((frame / totalFrames) * target.length);
      const scrambled = target.split('').map((ch, i) =>
        i < resolved ? ch : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
      ).join('');
      setDisplayFormat(scrambled);
      scrambleTimer = setTimeout(tick, frameMs);
    };
    tick();
  };

  // ── DOM setters ───────────────────────────────────────────────────────────────
  const applyBox = (b: BoxResult) => {
    const { gl, gr, gt, gb } = b;
    vLineL.style.left = gl; vLineR.style.left = gr;
    hLineT.style.top  = gt; hLineB.style.top  = gb;
    crossTL.style.top = `calc(${gt} - 10px)`; crossTL.style.left = `calc(${gl} - 10px)`;
    crossTR.style.top = `calc(${gt} - 10px)`; crossTR.style.left = `calc(${gr} - 10px)`;
    crossBL.style.top = `calc(${gb} - 10px)`; crossBL.style.left = `calc(${gl} - 10px)`;
    crossBR.style.top = `calc(${gb} - 10px)`; crossBR.style.left = `calc(${gr} - 10px)`;
    bboxEl.style.left   = gl;
    bboxEl.style.top    = gt;
    bboxEl.style.width  = `calc(${gr} - ${gl})`;
    bboxEl.style.height = `calc(${gb} - ${gt})`;
    topBarEl.style.left   = gl;
    topBarEl.style.width  = `calc(${gr} - ${gl})`;
    topBarEl.style.top    = b.topBarTopPct;
    topBarEl.style.height = b.topBarHPct;
    settingsEl.style.left = b.settingsLeft;
    settingsEl.style.top  = b.settingsTop;
  };

  const snapToIdle = () => {
    vLineL.style.left = IDLE_GL; vLineR.style.left = IDLE_GR;
    hLineT.style.top  = IDLE_GT; hLineB.style.top  = IDLE_GB;
    crossTL.style.top = `calc(${IDLE_GT} - 10px)`; crossTL.style.left = `calc(${IDLE_GL} - 10px)`;
    crossTR.style.top = `calc(${IDLE_GT} - 10px)`; crossTR.style.left = `calc(${IDLE_GR} - 10px)`;
    crossBL.style.top = `calc(${IDLE_GB} - 10px)`; crossBL.style.left = `calc(${IDLE_GL} - 10px)`;
    crossBR.style.top = `calc(${IDLE_GB} - 10px)`; crossBR.style.left = `calc(${IDLE_GR} - 10px)`;
    bboxEl.style.left = IDLE_GL; bboxEl.style.top = IDLE_GT;
    bboxEl.style.width = `calc(${IDLE_GR} - ${IDLE_GL})`; bboxEl.style.height = `calc(${IDLE_GB} - ${IDLE_GT})`;
    topBarEl.style.left = IDLE_GL; topBarEl.style.width = `calc(${IDLE_GR} - ${IDLE_GL})`;
    topBarEl.style.top = IDLE_GT;
  };

  // ── Transitions ───────────────────────────────────────────────────────────────
  const buildTr = (a: ReturnType<typeof anim>, landscape: boolean, dropdownDur?: number): TransitionSet => {
    const { x1, y1, x2, y2 } = a.easing;
    const ease = `cubic-bezier(${x1},${y1},${x2},${y2})`;
    if (dropdownDur != null) {
      const Dd = `${dropdownDur}s ${ease}`;
      return {
        vLines:  `left ${Dd}`,
        hLines:  `top ${Dd}`,
        crosses: `top ${Dd}, left ${Dd}`,
        bbox:    `top ${Dd}, height ${Dd}, left ${Dd}, width ${Dd}`,
        topBar:  `top ${Dd}, height ${Dd}, left ${Dd}, width ${Dd}`,
      };
    }
    const { p1_dur, p2_dur, p2_delay } = a.timing;
    const Pv = landscape ? `${p2_dur}s ${ease} ${p2_delay}s` : `${p1_dur}s ${ease}`;
    const Ph = landscape ? `${p1_dur}s ${ease}`               : `${p2_dur}s ${ease} ${p2_delay}s`;
    return {
      vLines:  `left ${Ph}`,
      hLines:  `top ${Pv}`,
      crosses: `top ${Pv}, left ${Ph}`,
      bbox:    `top ${Pv}, height ${Pv}, left ${Ph}, width ${Ph}`,
      topBar:  `top ${Pv}, height ${Pv}, left ${Ph}, width ${Ph}`,
    };
  };

  const applyTr = (tr: TransitionSet) => {
    vLineL.style.transition = tr.vLines;
    vLineR.style.transition = tr.vLines;
    hLineT.style.transition = tr.hLines;
    hLineB.style.transition = tr.hLines;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => { el.style.transition = tr.crosses; });
    bboxEl.style.transition   = tr.bbox;
    topBarEl.style.transition = tr.topBar;
  };

  // ── Effects ───────────────────────────────────────────────────────────────────
  // Transition effect: use dropdown.dur whenever fmtOpen CHANGES (open OR close).
  // Deliberately does NOT read box() so it isn't re-triggered by the box signal
  // updating after fmtOpen changes — which would overwrite the dropdown transition
  // with the regular p1/p2 one before the animation finishes.
  const isLandscape = props.video.width >= props.video.height;
  let prevFmtOpen = false;
  createEffect(() => {
    const a = anim(); const isOpen = fmtOpen();
    const changed = isOpen !== prevFmtOpen;
    prevFmtOpen = isOpen;
    applyTr(buildTr(a, isLandscape, changed ? a.dropdown.dur : undefined));
  });
  createEffect(() => { const b = box(); if (!b) return; applyBox(b); });
  createEffect(() => {
    const l = layout(); const { vw, vh } = vp();
    const isOpen = fmtOpen();
    if (vw === 0 || vh === 0 || !untrack(box)) return;
    // When dropdown opens, push the video top down by the height of the dropdown content.
    // nItems is always FORMATS.length - 1 (exactly one format is selected/excluded).
    let extraTopPx = 0;
    if (isOpen) {
      const nItems = FORMATS.length - 1;
      extraTopPx = 1 + nItems * 20 + Math.max(0, nItems - 1) + 24;
    }
    setBox(computeBox(vw, vh, props.video.width, props.video.height, l, extraTopPx));
  });

  // ── Animations ────────────────────────────────────────────────────────────────
  let isExiting = false;

  const triggerEnter = () => {
    const a = anim(); const l = layout();
    const vw = containerRef.offsetWidth; const vh = containerRef.offsetHeight;
    const target = computeBox(vw, vh, props.video.width, props.video.height, l);
    const tr = buildTr(a, target.isLandscape);
    [vLineL, vLineR, hLineT, hLineB, crossTL, crossTR, crossBL, crossBR, bboxEl, topBarEl]
      .forEach(el => { el.style.transition = 'none'; });
    snapToIdle();
    topBarEl.style.opacity = '0';
    settingsEl.style.opacity = '0';
    void containerRef.getBoundingClientRect();
    requestAnimationFrame(() => {
      applyTr(tr); void containerRef.getBoundingClientRect(); applyBox(target);
      requestAnimationFrame(() => {
        const { fade_dur, fade_delay } = a.timing;
        topBarEl.style.transition  = tr.topBar + `, opacity ${fade_dur}s ease ${fade_delay}s`;
        topBarEl.style.opacity     = '1';
        settingsEl.style.transition = `opacity ${fade_dur}s ease ${fade_delay + 0.05}s`;
        settingsEl.style.opacity   = '1';
        const endMs = Math.max(a.timing.p1_dur, a.timing.p2_dur + a.timing.p2_delay, fade_delay + fade_dur) * 1000 + 32;
        setTimeout(() => {
          const nVw = containerRef.offsetWidth; const nVh = containerRef.offsetHeight;
          setVp({ vw: nVw, vh: nVh });
          setBox(computeBox(nVw, nVh, props.video.width, props.video.height, layout()));
        }, endMs);
      });
    });
  };

  const triggerExit = () => {
    if (isExiting) return; isExiting = true;
    const a = anim(); const b = box();
    if (!b) { props.onBack(); return; }
    const tr = buildTr(a, !b.isLandscape);
    const { fade_dur } = a.timing;
    requestAnimationFrame(() => {
      applyTr(tr);
      topBarEl.style.transition   = tr.topBar + `, opacity ${fade_dur}s ease`;
      settingsEl.style.transition = `opacity ${fade_dur}s ease`;
      void containerRef.getBoundingClientRect();
      snapToIdle();
      topBarEl.style.opacity = '0'; settingsEl.style.opacity = '0';
      const endMs = Math.max(a.timing.p1_dur, a.timing.p2_dur + a.timing.p2_delay, fade_dur) * 1000 + 32;
      setTimeout(() => props.onBack(), endMs);
    });
  };

  // ── Mount ─────────────────────────────────────────────────────────────────────
  onMount(() => {
    setVp({ vw: containerRef.offsetWidth, vh: containerRef.offsetHeight });
    triggerEnter();
    const ro = new ResizeObserver(() => {
      if (isExiting) return;
      const vw = containerRef.offsetWidth; const vh = containerRef.offsetHeight;
      if (vw === vp().vw && vh === vp().vh) return;
      setVp({ vw, vh });
    });
    ro.observe(containerRef);
    onCleanup(() => { ro.disconnect(); if (scrambleTimer != null) clearTimeout(scrambleTimer); });
  });

  const crossStyle = { position: 'absolute' as const, width: '20px', height: '20px' };
  const armV = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px', height: '20px', background: ACCENT };
  const armH = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px', background: ACCENT };

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: '0', background: BG, overflow: 'hidden', '-webkit-app-region': 'drag' } as any}>

      {/* ── Bounding box (video + overlay) ─────────────────────────────────── */}
      <div ref={bboxEl} style={{ position: 'absolute', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        <video
          src={props.video.objectUrl}
          autoplay loop muted playsinline
          style={{ width: '100%', height: '100%', display: 'block', 'object-fit': 'cover' }}
        />
        {/* Video overlay — padding: 16px (p-4 from Paper) */}
        <div style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'flex-direction': 'column',
          'justify-content': 'space-between',
          padding: '24px',
          'pointer-events': 'none',
          'box-sizing': 'border-box',
        }}>
          {/* Top row: EXPECTED SIZE chips | + cross (center) | → arrow (right) */}
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', width: '100%' }}>
            {/* Left: EXPECTED SIZE stacked chips */}
            <div style={{ display: 'flex', 'flex-direction': 'column' }}>
              <Chip>EXPECTED SIZE</Chip>
              <Chip>27.5 MB</Chip>
            </div>
            {/* Center: + cross */}
            <Cross />
            {/* Right: → arrow */}
            <ArrowSvg width={20} height={22} />
          </div>

          {/* Bottom: play + 14s + timeline */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-self': 'stretch', 'pointer-events': 'auto' }}>
            {/* Row: play button + 14s duration */}
            <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
              <ChevronSvg width={16} height={16} />
              <Chip size="xs">14s</Chip>
            </div>
            {/* Timeline */}
            <Timeline />
          </div>
        </div>
      </div>

      {/* ── Top bar area: always the same DOM structure, height animated open/closed ── */}
      {/* Button row stays at a stable position (height = topBarHPx) in both states.
          Format items are always in the DOM — overflow:hidden on the container clips them
          when closed, and the height animation reveals them smoothly when opening.
          This avoids any position jump caused by layout differences between states. */}
      <div ref={topBarEl} style={{ position: 'absolute', 'box-sizing': 'border-box', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}>
        {/* ── Button row: 24px padding on all sides, same position open or closed ── */}
        <div style={{
          display: 'flex', 'align-items': 'center', 'justify-content': 'space-between',
          'padding-inline': '24px',
          'padding-block': '24px',
          'box-sizing': 'border-box',
          'flex-shrink': '0',
        }}>
          <Show when={fmtOpen()} fallback={
            <FormatButtonClosed format={displayFormat()} onClick={() => setFmtOpen(true)} />
          }>
            <FormatButtonOpen format={displayFormat()} onClick={() => setFmtOpen(false)} />
          </Show>
          <div style={{ cursor: 'pointer' }} onClick={triggerExit}>
            <XSvg width={20} height={22} />
          </div>
        </div>
        {/* ── Format items: always in DOM, revealed by overflow:hidden as height grows ── */}
        <div style={{
          'padding-inline': '24px',
          'padding-bottom': '24px',
          display: 'flex', 'flex-direction': 'column',
          gap: '1px',
          'margin-top': '1px',
          'pointer-events': fmtOpen() ? 'auto' : 'none',
        }}>
          <For each={FORMATS.filter(f => f !== format())}>
            {(fmt) => (
              <div
                style={{ 'font-family': MONO, 'font-size': '16px', 'line-height': '20px', color: ACCENT, cursor: 'pointer', 'user-select': 'none' }}
                onClick={() => { setFormat(fmt); scramble(fmt); setFmtOpen(false); }}
              >
                {fmt}
              </div>
            )}
          </For>
        </div>
      </div>

      {/* ── VIDEO SETTINGS label ────────────────────────────────────────────── */}
      <div
        ref={settingsEl}
        style={{ position: 'absolute', cursor: 'pointer', '-webkit-app-region': 'no-drag' } as any}
      >
        <span style={{
          'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
          color: ACCENT, 'white-space': 'nowrap',
        }}>
          VIDEO SETTINGS
        </span>
      </div>

      {/* ── Guide lines ─────────────────────────────────────────────────────── */}
      <div ref={vLineL} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={vLineR} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineT} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineB} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />

      {/* ── Corner crosshairs ───────────────────────────────────────────────── */}
      <div ref={crossTL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossTR} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBR} style={crossStyle}><div style={armV} /><div style={armH} /></div>

    </div>
  );
};

export default EditorView;
