import { Component, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from 'solid-js';
import { createDialKit } from 'dialkit/solid';
import type { VideoInfo } from '../../App';

// ── Fixed UI constants ─────────────────────────────────────────────────────────
const ACCENT    = '#FC006D';
const ACCENT_75 = 'rgba(252,0,109,0.75)';
const BG        = '#F8F7F6';
const MONO      = "'IBM Plex Mono', system-ui, monospace";
const SANS      = "'IBM Plex Sans', system-ui, sans-serif";
const OVL_PAD   = '16px';

// ── Idle guide positions (enter-animation start point) ─────────────────────────
const IDLE_GL = '18.1%'; const IDLE_GR = '81.9%';
const IDLE_GT = '31.2%'; const IDLE_GB = '68.8%';

// ── Types ──────────────────────────────────────────────────────────────────────
interface LayoutCfg {
  ML: number; MT: number; MB: number;
  CTRL_H: number; CTRL_W: number; PANEL_M_F: number;
}

interface CtrlLayout {
  left: string; top: string; right: string; width: string;
  height: string; bottom: string;
  flexDirection: 'row' | 'column'; gap: string;
}

interface BoxResult {
  left: number; top: number; right: number; bottom: number;
  isLandscape: boolean;
  gl: string; gr: string; gt: string; gb: string;
  ctrl: CtrlLayout;
}

interface TransitionSet {
  vLines: string; hLines: string; crosses: string; bbox: string; ctrl: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────
const pct = (v: number, of: number) => (v / of * 100).toFixed(3) + '%';

function computeBox(vw: number, vh: number, videoW: number, videoH: number, cfg: LayoutCfg): BoxResult {
  const { ML, MT, MB, CTRL_H, CTRL_W, PANEL_M_F } = cfg;
  const isLandscape = videoW >= videoH;
  let left: number, top: number, right: number, bottom: number;

  if (isLandscape) {
    left = vw * ML;   top = vh * MT;
    right = vw * (1 - ML);   bottom = vh * (1 - MB - CTRL_H);
  } else {
    left = vw * ML;   top = vh * MT;
    right = vw * (1 - ML - CTRL_W);   bottom = vh * (1 - MB);
  }

  const bboxW = right - left;
  let ctrl: CtrlLayout;

  if (isLandscape) {
    const zoneH  = vh - bottom;
    const panelM = bboxW * PANEL_M_F;
    ctrl = {
      left:  pct(left   + panelM, vw), top:    pct(bottom + panelM, vh),
      width: pct(bboxW  - panelM * 2, vw), height: pct(zoneH  - panelM * 2, vh),
      right: '', bottom: '', flexDirection: 'row', gap: `${panelM}px`,
    };
  } else {
    const zoneW  = vw * (1 - ML) - right;
    const zoneH  = bottom - top;
    const panelM = Math.min(zoneW, zoneH) * PANEL_M_F;
    const halfML = vw * ML / 2;
    ctrl = {
      left:  pct(right + halfML + panelM, vw), top:    pct(top + panelM, vh),
      right: pct(halfML + panelM, vw),          height: pct(zoneH - panelM * 2, vh),
      width: '', bottom: '', flexDirection: 'column', gap: `${panelM}px`,
    };
  }

  return {
    left, top, right, bottom, isLandscape, ctrl,
    gl: pct(left,  vw), gr: pct(right,  vw),
    gt: pct(top,   vh), gb: pct(bottom, vh),
  };
}

// ── Sub-components ─────────────────────────────────────────────────────────────
const InlineCross = () => (
  <div style={{ position: 'relative', width: '20px', height: '20px', 'flex-shrink': '0' }}>
    <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
    <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
  </div>
);

const Chip = (p: { text: string; font?: string }) => (
  <div style={{ display: 'flex', 'align-items': 'center', 'width': 'fit-content', 'height': 'fit-content', background: ACCENT }}>
    <span style={{
      'font-family': p.font ?? MONO, 'font-size': '16px', 'line-height': '20px',
      'font-weight': '400', color: BG, 'white-space': 'nowrap',
    }}>{p.text}</span>
  </div>
);

const fmtBytes = (b: number) => {
  if (b === 0) return '—';
  if (b < 1024 * 1024) return (b / 1024).toFixed(2) + ' KB';
  return (b / (1024 * 1024)).toFixed(2) + ' MB';
};

// ── Component ──────────────────────────────────────────────────────────────────
const EditorView: Component<{ video: VideoInfo; onBack: () => void }> = (props) => {
  let containerRef!: HTMLDivElement;
  let vLineL!: HTMLDivElement, vLineR!: HTMLDivElement;
  let hLineT!: HTMLDivElement, hLineB!: HTMLDivElement;
  let crossTL!: HTMLDivElement, crossTR!: HTMLDivElement;
  let crossBL!: HTMLDivElement, crossBR!: HTMLDivElement;
  let bboxEl!: HTMLDivElement, ctrlEl!: HTMLDivElement;

  // ── Dials ────────────────────────────────────────────────────────────────────
  const layout = createDialKit('Layout', {
    ML:        [0.028,  0.005, 0.15,  0.001],
    MT:        [0.0613, 0.01,  0.2,   0.001],
    MB:        [0.083,  0.01,  0.2,   0.001],
    CTRL_H:    [0.32,   0.1,   0.6,   0.01 ],
    CTRL_W:    [0.615,  0.3,   0.85,  0.01 ],
    PANEL_M_F: [0.04,   0.005, 0.15,  0.005],
  });

  const anim = createDialKit('Animation', {
    timing: {
      p1_dur:     [0.35, 0.05, 3.0, 0.05],   // vertical phase duration
      p2_dur:     [0.35, 0.05, 3.0, 0.05],   // horizontal phase duration
      p2_delay:   [0.35, 0.0,  2.0, 0.05],   // horizontal phase delay
      fade_dur:   [0.25, 0.05, 2.0, 0.05],   // ctrl panel fade duration
      fade_delay: [0.55, 0.0,  2.0, 0.05],   // ctrl panel fade delay
    },
    // cubic-bezier(x1, y1, x2, y2)
    // x1/x2 must stay in [0,1]; y1/y2 can exceed range for overshoot/bounce
    easing: {
      x1: [1.0,   0.0,  1.0, 0.01],
      y1: [-0.35, -1.0, 2.0, 0.01],
      x2: [0.22,  0.0,  1.0, 0.01],
      y2: [1.15,  -1.0, 2.0, 0.01],
    },
    replay: { type: 'action' as const },
  }, {
    onAction: (path) => { if (path === 'replay') triggerEnter(); },
  });

  // ── State ────────────────────────────────────────────────────────────────────
  const [box, setBox] = createSignal<BoxResult | null>(null);
  const isLandscape   = createMemo(() => box()?.isLandscape ?? true);
  const [vp, setVp]   = createSignal({ vw: 0, vh: 0 });

  // ── Pure DOM setter — no signal reads, safe to call from any effect ──────────
  const applyBox = (b: BoxResult) => {
    const { gl, gr, gt, gb, ctrl } = b;
    vLineL.style.left = gl;   vLineR.style.left = gr;
    hLineT.style.top  = gt;   hLineB.style.top  = gb;
    crossTL.style.top = `calc(${gt} - 10px)`;  crossTL.style.left = `calc(${gl} - 10px)`;
    crossTR.style.top = `calc(${gt} - 10px)`;  crossTR.style.left = `calc(${gr} - 10px)`;
    crossBL.style.top = `calc(${gb} - 10px)`;  crossBL.style.left = `calc(${gl} - 10px)`;
    crossBR.style.top = `calc(${gb} - 10px)`;  crossBR.style.left = `calc(${gr} - 10px)`;
    bboxEl.style.left   = gl;
    bboxEl.style.top    = gt;
    bboxEl.style.width  = `calc(${gr} - ${gl})`;
    bboxEl.style.height = `calc(${gb} - ${gt})`;
    ctrlEl.style.left          = ctrl.left;
    ctrlEl.style.top           = ctrl.top;
    ctrlEl.style.width         = ctrl.width;
    ctrlEl.style.height        = ctrl.height;
    ctrlEl.style.right         = ctrl.right;
    ctrlEl.style.bottom        = ctrl.bottom;
    ctrlEl.style.flexDirection = ctrl.flexDirection;
    ctrlEl.style.gap           = ctrl.gap;
  };

  // ── Transition builder ───────────────────────────────────────────────────────
  // Opacity is intentionally excluded from ctrl — it only animates during
  // triggerEnter so layout/resize changes don't cause the panel to flicker.
  //
  // Phase order depends on orientation:
  //   Portrait  → vertical (top/height) leads, horizontal (left/width) follows
  //   Landscape → horizontal (left/width) leads, vertical (top/height) follows
  const buildTr = (a: ReturnType<typeof anim>, landscape: boolean): TransitionSet => {
    const { x1, y1, x2, y2 } = a.easing;
    const ease = `cubic-bezier(${x1},${y1},${x2},${y2})`;
    const { p1_dur, p2_dur, p2_delay } = a.timing;
    const Pfirst  = `${p1_dur}s ${ease}`;
    const Psecond = `${p2_dur}s ${ease} ${p2_delay}s`;
    const Pv = landscape ? Psecond : Pfirst;   // vertical phase
    const Ph = landscape ? Pfirst  : Psecond;  // horizontal phase
    return {
      vLines:  `left ${Ph}`,
      hLines:  `top ${Pv}`,
      crosses: `top ${Pv}, left ${Ph}`,
      bbox:    `top ${Pv}, height ${Pv}, left ${Ph}, width ${Ph}`,
      ctrl:    `left ${Ph}, top ${Pv}, width ${Ph}, height ${Pv}, right ${Ph}, bottom ${Pv}`,
    };
  };

  const applyTr = (tr: TransitionSet) => {
    vLineL.style.transition = tr.vLines;
    vLineR.style.transition = tr.vLines;
    hLineT.style.transition = tr.hLines;
    hLineB.style.transition = tr.hLines;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => { el.style.transition = tr.crosses; });
    bboxEl.style.transition = tr.bbox;
    ctrlEl.style.transition = tr.ctrl;
  };

  // ── Effects ──────────────────────────────────────────────────────────────────
  // Effect order matters: transitions must be applied BEFORE positions change.
  // Effects run in creation order when the same signal (box) changes.

  // 1. Sync transitions whenever anim dials change or box updates (resize / dial tweak)
  createEffect(() => {
    const a = anim();
    const b = box();
    if (!b) return;
    applyTr(buildTr(a, b.isLandscape));
  });

  // 2. Apply box positions after transitions are already updated
  createEffect(() => {
    const b = box();
    if (!b) return;
    applyBox(b);
  });

  // 3. Recompute box when layout dials or viewport change
  //    Reads box() via untrack so this effect doesn't re-run when box changes
  createEffect(() => {
    const l        = layout();
    const { vw, vh } = vp();
    if (vw === 0 || vh === 0 || !untrack(box)) return;
    setBox(computeBox(vw, vh, props.video.width, props.video.height, l));
  });

  // ── Enter animation (also used by replay action) ─────────────────────────────
  // Entirely imperative — no signals are written during the animation so reactive
  // effects never fire and overwrite our carefully committed transition strings.
  // setBox is called only after everything completes to hand reactivity back.
  const triggerEnter = () => {
    const a      = anim();
    const l      = layout();
    const vw     = containerRef.offsetWidth;
    const vh     = containerRef.offsetHeight;
    const target = computeBox(vw, vh, props.video.width, props.video.height, l);
    const tr     = buildTr(a, target.isLandscape);

    // 1. Kill transitions, snap every element to IDLE positions
    [vLineL, vLineR, hLineT, hLineB, crossTL, crossTR, crossBL, crossBR, bboxEl, ctrlEl]
      .forEach(el => { el.style.transition = 'none'; });

    vLineL.style.left = IDLE_GL;   vLineR.style.left = IDLE_GR;
    hLineT.style.top  = IDLE_GT;   hLineB.style.top  = IDLE_GB;
    crossTL.style.top  = `calc(${IDLE_GT} - 10px)`;  crossTL.style.left = `calc(${IDLE_GL} - 10px)`;
    crossTR.style.top  = `calc(${IDLE_GT} - 10px)`;  crossTR.style.left = `calc(${IDLE_GR} - 10px)`;
    crossBL.style.top  = `calc(${IDLE_GB} - 10px)`;  crossBL.style.left = `calc(${IDLE_GL} - 10px)`;
    crossBR.style.top  = `calc(${IDLE_GB} - 10px)`;  crossBR.style.left = `calc(${IDLE_GR} - 10px)`;
    bboxEl.style.left   = IDLE_GL;   bboxEl.style.top    = IDLE_GT;
    bboxEl.style.width  = `calc(${IDLE_GR} - ${IDLE_GL})`;
    bboxEl.style.height = `calc(${IDLE_GB} - ${IDLE_GT})`;
    ctrlEl.style.opacity = '0';

    // 2. Commit IDLE state (browser records these values as animation start points)
    void containerRef.getBoundingClientRect();

    // 3. rAF 1 — restore transitions, move everything to target (no signals touched)
    requestAnimationFrame(() => {
      applyTr(tr);
      void containerRef.getBoundingClientRect(); // commit transitions before positions change

      applyBox(target); // positions change → CSS transitions fire against committed IDLE baseline

      // 4. rAF 2 — browser has painted one frame with opacity:0 committed; fade in ctrl
      requestAnimationFrame(() => {
        const { fade_dur, fade_delay } = a.timing;
        ctrlEl.style.transition = tr.ctrl + `, opacity ${fade_dur}s ease ${fade_delay}s`;
        ctrlEl.style.opacity = '1';

        // Hand reactivity back to effects after animation completes
        const endMs = Math.max(
          a.timing.p1_dur,
          a.timing.p2_dur + a.timing.p2_delay,
          fade_delay + fade_dur,
        ) * 1000 + 32; // +32ms (~2 frames) buffer

        setTimeout(() => {
          // Recompute from current viewport in case window was resized during animation
          const newVw = containerRef.offsetWidth;
          const newVh = containerRef.offsetHeight;
          setVp({ vw: newVw, vh: newVh });
          setBox(computeBox(newVw, newVh, props.video.width, props.video.height, layout()));
          // Effects now own transitions and positions; opacity is already 1 so
          // effect 1 stripping opacity from ctrl transition causes no visual change
        }, endMs);
      });
    });
  };

  // ── Exit animation ───────────────────────────────────────────────────────────
  // Reversed phase order vs enter: the axis that arrived last departs first.
  // Entirely imperative — no signals written, so reactive effects stay silent.
  let isExiting = false;

  const triggerExit = () => {
    if (isExiting) return;
    isExiting = true;

    const a = anim();
    const b = box();
    if (!b) { props.onBack(); return; }

    // Reversed: swap which axis leads (portrait → horizontal first, landscape → vertical first)
    const tr = buildTr(a, !b.isLandscape);
    const { fade_dur } = a.timing;

    requestAnimationFrame(() => {
      // Set reversed transitions (ctrl gets opacity fade-out too)
      applyTr(tr);
      ctrlEl.style.transition = tr.ctrl + `, opacity ${fade_dur}s ease`;

      // Commit transitions as the "before" state
      void containerRef.getBoundingClientRect();

      // Animate everything to IDLE positions
      vLineL.style.left = IDLE_GL;   vLineR.style.left = IDLE_GR;
      hLineT.style.top  = IDLE_GT;   hLineB.style.top  = IDLE_GB;
      crossTL.style.top  = `calc(${IDLE_GT} - 10px)`;  crossTL.style.left = `calc(${IDLE_GL} - 10px)`;
      crossTR.style.top  = `calc(${IDLE_GT} - 10px)`;  crossTR.style.left = `calc(${IDLE_GR} - 10px)`;
      crossBL.style.top  = `calc(${IDLE_GB} - 10px)`;  crossBL.style.left = `calc(${IDLE_GL} - 10px)`;
      crossBR.style.top  = `calc(${IDLE_GB} - 10px)`;  crossBR.style.left = `calc(${IDLE_GR} - 10px)`;
      bboxEl.style.left   = IDLE_GL;   bboxEl.style.top    = IDLE_GT;
      bboxEl.style.width  = `calc(${IDLE_GR} - ${IDLE_GL})`;
      bboxEl.style.height = `calc(${IDLE_GB} - ${IDLE_GT})`;
      ctrlEl.style.opacity = '0';

      const endMs = Math.max(
        a.timing.p1_dur,
        a.timing.p2_dur + a.timing.p2_delay,
        fade_dur,
      ) * 1000 + 32;

      setTimeout(() => props.onBack(), endMs);
    });
  };

  // ── Mount ────────────────────────────────────────────────────────────────────
  onMount(() => {
    // Seed viewport so effect 3 can run on layout-dial changes
    setVp({ vw: containerRef.offsetWidth, vh: containerRef.offsetHeight });

    triggerEnter();

    // ResizeObserver drives viewport updates → effect 3 recomputes box.
    // Guard against duplicate fires (same size) and against the exit animation.
    const ro = new ResizeObserver(() => {
      if (isExiting) return;
      const vw = containerRef.offsetWidth;
      const vh = containerRef.offsetHeight;
      if (vw === vp().vw && vh === vp().vh) return;
      setVp({ vw, vh });
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // ── Crosshair arm styles ─────────────────────────────────────────────────────
  const crossStyle = { position: 'absolute' as const, width: '20px', height: '20px' };
  const armV = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px',  height: '20px', background: ACCENT };
  const armH = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px',  background: ACCENT };

  return (
    <div ref={containerRef} style={{ position: 'fixed', inset: '0', background: BG, overflow: 'hidden' }}>

      {/* Bounding box + video */}
      <div ref={bboxEl} style={{ position: 'absolute', overflow: 'hidden' }}>
        <video
          src={props.video.objectUrl}
          autoplay loop muted playsinline
          style={{ width: '100%', height: '100%', 'object-fit': 'cover', display: 'block' }}
        />
        <div style={{
          position: 'absolute', inset: '0', display: 'flex', 'flex-direction': 'column',
          'justify-content': 'space-between', padding: OVL_PAD, 'pointer-events': 'none',
        }}>
          {/* Top row */}
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', width: '100%' }}>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '0' }}>
              <Chip text="FILE LOADED" />
              <Chip text={fmtBytes(props.video.sizeBytes)} />
            </div>
            <InlineCross />
            {isLandscape() && <InlineCross />}
            <div
              style={{ display: 'flex', 'align-items': 'center', background: ACCENT,
                'padding-block': '1px', 'padding-inline': '6px', cursor: 'pointer', 'pointer-events': 'auto' }}
              onClick={triggerExit}
            >
              <span style={{ 'font-family': SANS, 'font-size': '16px', 'line-height': '20px', color: BG }}>X</span>
            </div>
          </div>
          {/* Bottom row */}
          <div style={{ display: 'flex', 'align-items': 'center', 'justify-content': 'space-between', width: '100%' }}>
            <Chip text="EXPECTED SIZE" />
            <InlineCross />
            {isLandscape() && <InlineCross />}
            <Chip text="—" />
          </div>
        </div>
      </div>

      {/* Guide lines — rendered after bbox so they appear on top */}
      <div ref={vLineL} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={vLineR} style={{ position: 'absolute', top: '0', bottom: '0', width: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineT} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />
      <div ref={hLineB} style={{ position: 'absolute', left: '0', right: '0', height: '1px', background: ACCENT_75, 'pointer-events': 'none' }} />

      {/* Corner crosshairs */}
      <div ref={crossTL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossTR} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBL} style={crossStyle}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBR} style={crossStyle}><div style={armV} /><div style={armH} /></div>

      {/* Control panels */}
      <div ref={ctrlEl} style={{ position: 'absolute', display: 'flex' }}>
        <div style={{ flex: '595', border: `1px solid ${ACCENT}`, 'box-sizing': 'border-box', 'min-height': '0', 'min-width': '0' }} />
        <div style={{ flex: '234', border: `1px solid ${ACCENT}`, 'box-sizing': 'border-box', 'min-height': '0', 'min-width': '0' }} />
      </div>

    </div>
  );
};

export default EditorView;
