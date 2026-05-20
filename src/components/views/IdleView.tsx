import { Component, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import { setAppState } from '../../state/app';
import { uploadFileWithProgress, waitForPreview } from '../../api/upload';
import { pct, scrambleText } from '../../shared/utils';
import CarrierBricks from '../loading/CarrierBricks';

// ── Guide positions ───────────────────────────────────────────────────────────
const SPLASH = { GL: '2.8%',  GR: '97.2%', GT: '6.13%', GB: '92.4%'  };

// Idle bbox cycles through these aspect ratios — one step forward per cross
// spin. Order: HD widescreen → vertical mobile → 4:3 → square, then loops.
const IDLE_RATIOS = [16 / 9, 9 / 16, 4 / 3, 1 / 1];

// Compute idle bounding box guide percentages from actual viewport dimensions.
// Uses the same logic as bbox-calc.ts so the idle box is always properly centered
// and aspect-ratio-constrained regardless of window size.
function computeIdlePos(vw: number, vh: number, aspect: number) {
  const { x1, y1, x2, y2 } = calculateBBoxTargets(vw, vh, aspect, 'idle');
  return {
    x1, y1, x2, y2,
    gl: pct(x1, vw), gr: pct(x2, vw),
    gt: pct(y1, vh), gb: pct(y2, vh),
    // Anchor text 16px above the bottom guide so it always sits inside the bbox.
    helperBottom: (vh - y2 + 16) + 'px',
  };
}

// Bar-shape positions used when the bbox morphs into a loading bar during
// upload / URL fetch. Mirrors the playground shortlist: 60vw × 80px centered.
const LOADING_BAR_W_RATIO = 0.60;
const LOADING_BAR_H_PX    = 80;
function computeLoadingPos(vw: number, vh: number) {
  const barW = vw * LOADING_BAR_W_RATIO;
  const barH = LOADING_BAR_H_PX;
  const x1 = (vw - barW) / 2;
  const y1 = (vh - barH) / 2;
  const x2 = x1 + barW;
  const y2 = y1 + barH;
  return {
    x1, y1, x2, y2,
    gl: pct(x1, vw), gr: pct(x2, vw),
    gt: pct(y1, vh), gb: pct(y2, vh),
    helperBottom: (vh - y2 + 16) + 'px',
  };
}

import { ACCENT, BG, DOT_BG_IMAGE } from '../../shared/tokens';
import { Chip, Cross, CornerCrosshair, GuideLine } from '../../shared/ui';

type Phase = 'splash' | 'contracting' | 'idle' | 'loading';

// ── Tracks whether the intro has already played this session ──────────────────
// Stored on `window` so the flag survives both IdleView unmount/remount (e.g.
// after pressing X) AND Vite HMR module re-evaluation (which would re-declare
// a module-level `let`). Resets on a full page reload (fresh app launch).
const _hl = () => !!(window as any).__convertrLaunched;
const _markLaunched = () => { (window as any).__convertrLaunched = true; };

// ── Main view ────────────────────────────────────────────────────────────────
const IdleView: Component<{ onVideoSelected: (info: VideoInfo) => void }> = (props) => {

  // ── Static config ────────────────────────────────────────────────────────────
  const p = {
    phases: { splash_ms: 700, contract_ms: 100 },
    // Match EditorView's bbox easing — pronounced undershoot/overshoot so the
    // idle → loading morph (and the idle aspect-ratio cycle) feel like the
    // rest of the app instead of a flat ease-in-out.
    guides: { dur: 0.3, x1: 1.0, y1: -0.35, x2: 0.22, y2: 1.15 },
    logo:   { dur: 0.3 },
    text:   { line1_dur: 0.2, line2_dur: 0.2, line2_delay: 0.1, x1: 0.0, y1: 1.0, x2: 0.28, y2: 1.0 },
    helper_fade_dur: 0.1,
  };

  const guideEase = `cubic-bezier(${p.guides.x1},${p.guides.y1},${p.guides.x2},${p.guides.y2})`;
  const textEase = `cubic-bezier(${p.text.x1},${p.text.y1},${p.text.x2},${p.text.y2})`;

  // ── Viewport size (drives responsive idle bbox) ────────────────────────────
  const [vp, setVp] = createSignal({ vw: 0, vh: 0 });
  // Index into IDLE_RATIOS — advanced by the spin interval so each cross
  // rotation lands the bbox on a new shape. Reactive so the idlePos memo
  // recomputes and the existing guide-transition effect smoothly animates
  // the lines / corner crosses to the new positions.
  const [bboxRatioIndex, setBboxRatioIndex] = createSignal(0);
  const currentIdleAspect = createMemo(() => IDLE_RATIOS[bboxRatioIndex() % IDLE_RATIOS.length]);
  const idlePos = createMemo(() => {
    const { vw, vh } = vp();
    const aspect = currentIdleAspect();
    if (vw <= 0 || vh <= 0) return computeIdlePos(1, 1, aspect); // safe fallback
    return computeIdlePos(vw, vh, aspect);
  });
  const loadingPos = createMemo(() => {
    const { vw, vh } = vp();
    if (vw <= 0 || vh <= 0) return computeLoadingPos(1, 1);
    return computeLoadingPos(vw, vh);
  });

  // ── Phase state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = createSignal<Phase>(_hl() ? 'idle' : 'splash');
  const isIdle = createMemo(() => phase() === 'idle');
  const isLoading = createMemo(() => phase() === 'loading');

  // ── Loading bar (time-driven, continuous) ────────────────────────────────
  // One seamless ramp from 0 → 100. The pacer starts once the bbox → bar
  // morph has completed (BAR_FADE_MS) so the bar appears at 0%, not mid-
  // fill. Animates 0 → HOLD_AT over ANIMATE_MS (ease-out), holds there
  // until the real job reports done, then closes HOLD_AT → 100 over
  // FINISH_MS before firing the transition to EditorView. No gate resets,
  // no smoothing jumps — single continuous animation.
  const BAR_FADE_MS = 700; // = (STAGGER_P1 + STAGGER_DELAY + STAGGER_P2) * 1000
  const ANIMATE_MS = 3000;
  const FINISH_MS  = 350;
  const HOLD_AT    = 92;

  const [loadingProgress, setLoadingProgress] = createSignal(0);
  const [pendingTransition, setPendingTransition] = createSignal<(() => void) | null>(null);

  type PacerPhase = 'idle' | 'animating' | 'holding' | 'finishing';
  let pacerPhase: PacerPhase = 'idle';
  let pacerStart = 0;
  let finishStart = 0;
  let pacerRaf = 0;

  const easeOutQuad = (tt: number) => 1 - (1 - tt) * (1 - tt);

  const pacerTick = (now: number) => {
    if (pacerPhase === 'animating') {
      const tt = Math.min(1, (now - pacerStart) / ANIMATE_MS);
      setLoadingProgress(easeOutQuad(tt) * HOLD_AT);
      if (tt >= 1) {
        if (pendingTransition()) {
          pacerPhase = 'finishing';
          finishStart = now;
        } else {
          pacerPhase = 'holding';
        }
      }
    } else if (pacerPhase === 'holding') {
      if (pendingTransition()) {
        pacerPhase = 'finishing';
        finishStart = now;
      }
    } else if (pacerPhase === 'finishing') {
      const tt = Math.min(1, (now - finishStart) / FINISH_MS);
      setLoadingProgress(HOLD_AT + (100 - HOLD_AT) * tt);
      if (tt >= 1) {
        const fire = pendingTransition();
        setPendingTransition(null);
        pacerPhase = 'idle';
        pacerRaf = 0;
        if (fire) fire();
        return;
      }
    }
    pacerRaf = requestAnimationFrame(pacerTick);
  };

  // Run the pacer while phase is 'loading'. Starts AFTER the bbox → bar
  // morph so the bar begins at 0%. Cleanup cancels the RAF and resets.
  createEffect(() => {
    if (!isLoading()) {
      if (pacerRaf) { cancelAnimationFrame(pacerRaf); pacerRaf = 0; }
      pacerPhase = 'idle';
      setLoadingProgress(0);
      return;
    }
    const start = setTimeout(() => {
      pacerPhase = 'animating';
      pacerStart = performance.now();
      setLoadingProgress(0);
      pacerRaf = requestAnimationFrame(pacerTick);
    }, BAR_FADE_MS);
    onCleanup(() => {
      clearTimeout(start);
      if (pacerRaf) { cancelAnimationFrame(pacerRaf); pacerRaf = 0; }
      pacerPhase = 'idle';
    });
  });

  const startPacedLoading = () => {
    setPendingTransition(null);
  };

  // Call when the real work (XHR or SSE) has completed successfully. The
  // pacer fires the transition after its close-out animation finishes.
  const finishPacedLoading = (onDone: () => void) => {
    // Signal setter treats a raw function as an updater; wrap to store the fn.
    setPendingTransition(() => onDone);
  };

  const stopPacedLoading = () => {
    setPendingTransition(null);
  };

  // Timeout refs so we can cancel and restart on replay
  let t1 = 0, t2 = 0;

  const startTimers = () => {
    clearTimeout(t1); clearTimeout(t2);
    const { splash_ms, contract_ms } = p.phases;
    t1 = setTimeout(() => setPhase('contracting'), splash_ms) as unknown as number;
    t2 = setTimeout(() => setPhase('idle'), splash_ms + contract_ms) as unknown as number;
  };

  const restartAnimation = () => {
    setPhase('splash');
    // Let the DOM reset to splash positions before re-running timers
    requestAnimationFrame(() => startTimers());
  };

  // ── DOM refs ───────────────────────────────────────────────────────────────
  let rootEl!: HTMLDivElement;
  let vLineL!: HTMLDivElement, vLineR!: HTMLDivElement;
  let hLineT!: HTMLDivElement, hLineB!: HTMLDivElement;
  let crossTL!: HTMLDivElement, crossTR!: HTMLDivElement;
  let crossBL!: HTMLDivElement, crossBR!: HTMLDivElement;
  let dotBg!: HTMLDivElement;
  let centerCrossEl!: HTMLDivElement;

  // ── Idle spin for the center cross ───────────────────────────────────────
  // Every IDLE_SPIN_INTERVAL_MS the cross does one full spin plus a 90°
  // overshoot (0° → 450°), then springs back to 360° (visually 0°). Per-
  // segment easing: the spin uses an ease-out curve so it decelerates into
  // the peak, and the return uses a cubic-bezier with y2 > 1 so the cross
  // briefly undershoots past 360° before settling — that's the "spring".
  const IDLE_SPIN_DURATION_MS = 700;
  const IDLE_SPIN_INTERVAL_MS = 3000;
  // Peak at 50% — symmetric wind-up and spring-back. The bbox transition
  // (both axes simultaneous, see STAGGER_P1/P2 below) runs for the full
  // spin duration and settles together with the cross at 700ms.
  const IDLE_SPIN_PEAK_OFFSET = 0.50;

  createEffect(() => {
    // Pause the idle spin whenever the user is hovering inside the bbox —
    // the hint chips are taking attention; the cross shouldn't compete.
    if (!isIdle() || hoveringBbox()) return;
    const interval = setInterval(() => {
      if (!centerCrossEl) return;
      centerCrossEl.animate(
        [
          { offset: 0,                    transform: 'rotate(0deg)',   easing: 'cubic-bezier(0.34, 0.0, 0.4, 1.0)' },
          { offset: IDLE_SPIN_PEAK_OFFSET, transform: 'rotate(450deg)', easing: 'cubic-bezier(0.5, 0.0, 0.4, 1.15)' },
          { offset: 1,                    transform: 'rotate(360deg)' },
        ],
        { duration: IDLE_SPIN_DURATION_MS },
      );
      // Bbox cycles to the next aspect ratio in lockstep with the spin —
      // the idlePos memo recomputes and the guide-transition effect carries
      // the lines / corner crosses to the new positions over ~700ms.
      setBboxRatioIndex(i => (i + 1) % IDLE_RATIOS.length);
    }, IDLE_SPIN_INTERVAL_MS);
    onCleanup(() => clearInterval(interval));
  });

  onMount(() => {
    if (!_hl()) {
      _markLaunched();
      startTimers();
    }
    onCleanup(() => { clearTimeout(t1); clearTimeout(t2); });

    const vw0 = rootEl.offsetWidth  || window.innerWidth;
    const vh0 = rootEl.offsetHeight || window.innerHeight;

    // Strip any residual transitions so the seed below is always an instant
    // snap — prevents leftover transitions (e.g. from HMR module reload)
    // from animating the seed and causing a wrong-direction expansion.
    [vLineL, vLineR, hLineT, hLineB].forEach(el => { el.style.transition = 'none'; });
    [crossTL, crossTR, crossBL, crossBR].forEach(el => { el.style.transition = 'none'; });
    dotBg.style.transition = 'none';
    void vLineL.offsetHeight;

    // Seed guide-line transforms at SPLASH positions BEFORE setVp so the
    // reactive effect doesn't animate from `transform: none` to SPLASH.
    vLineL.style.transform = `translateX(${vw0 * 0.028}px)`;
    vLineR.style.transform = `translateX(${vw0 * 0.972}px)`;
    hLineT.style.transform = `translateY(${vh0 * 0.0613}px)`;
    hLineB.style.transform = `translateY(${vh0 * 0.924}px)`;
    setVp({ vw: vw0, vh: vh0 });
    const ro = new ResizeObserver(() => {
      setVp({ vw: rootEl.offsetWidth, vh: rootEl.offsetHeight });
    });
    ro.observe(rootEl);
    onCleanup(() => ro.disconnect());
  });

  // Guide positions driven by phase — splash / idle / loading.
  const gl = createMemo(() => {
    if (phase() === 'splash')  return SPLASH.GL;
    if (phase() === 'loading') return loadingPos().gl;
    return idlePos().gl;
  });
  const gr = createMemo(() => {
    if (phase() === 'splash')  return SPLASH.GR;
    if (phase() === 'loading') return loadingPos().gr;
    return idlePos().gr;
  });
  const gt = createMemo(() => {
    if (phase() === 'splash')  return SPLASH.GT;
    if (phase() === 'loading') return loadingPos().gt;
    return idlePos().gt;
  });
  const gb = createMemo(() => {
    if (phase() === 'splash')  return SPLASH.GB;
    if (phase() === 'loading') return loadingPos().gb;
    return idlePos().gb;
  });

  // When remounting after a video cancel, skip the first transition so
  // guide lines and crosshairs don't animate from SPLASH to idle out of sync.
  let skipTransition = _hl();

  // Apply guide positions whenever phase or dial values change.
  // Both axes move simultaneously with a snappy 350ms duration — matches the
  // EditorView bbox and the Timeline/TrimRow transitions, so the idle → loading
  // morph feels like the rest of the app. The cross spin continues for 700ms
  // and is allowed to outlast the bbox settle. Skipped on the initial remount
  // after a video cancel so the lines don't flicker from SPLASH → idle.
  const STAGGER_P1 = 0.35;  // Y-axis duration
  const STAGGER_P2 = 0.35;  // X-axis duration
  const STAGGER_DELAY = 0;  // no leading delay — both start together
  createEffect(() => {
    const l = gl(), r = gr(), t = gt(), b = gb();
    const { vw, vh } = vp();
    const ph = phase();
    if (vw === 0 || vh === 0) return;
    const skip = skipTransition;
    if (skipTransition) skipTransition = false;
    // Horizontal lines (Y-axis = trTop) animate FIRST, no delay.
    // Vertical lines (X-axis = trLeft) animate SECOND with STAGGER_DELAY.
    const trTop  = skip ? `0s ${guideEase}` : `${STAGGER_P1}s ${guideEase}`;
    const trLeft = skip ? `0s ${guideEase}` : `${STAGGER_P2}s ${guideEase} ${STAGGER_DELAY}s`;

    // Resolve pixel positions for compositor-only line transforms
    let lPx: number, rPx: number, tPx: number, bPx: number;
    if (ph === 'splash') {
      lPx = vw * 0.028; rPx = vw * 0.972; tPx = vh * 0.0613; bPx = vh * 0.924;
    } else if (ph === 'loading') {
      const pos = loadingPos();
      lPx = pos.x1; rPx = pos.x2; tPx = pos.y1; bPx = pos.y2;
    } else {
      const pos = idlePos();
      lPx = pos.x1; rPx = pos.x2; tPx = pos.y1; bPx = pos.y2;
    }

    vLineL.style.transition = `transform ${trLeft}`;
    vLineR.style.transition = `transform ${trLeft}`;
    hLineT.style.transition = `transform ${trTop}`;
    hLineB.style.transition = `transform ${trTop}`;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => {
      el.style.transition = `top ${trTop}, left ${trLeft}`;
    });
    dotBg.style.transition = `left ${trLeft}, width ${trLeft}, top ${trTop}, height ${trTop}, opacity ${trLeft}`;
    // Force a layout flush so the new transition strings are committed BEFORE
    // any transform/position writes below — without this, when the same effect
    // re-runs on a phase change, the browser sees the transition string and
    // the target transform change in the same synchronous batch and can elide
    // the animation. Mirrors the trick used in EditorView's applyTr.
    void vLineL.offsetHeight;
    vLineL.style.transform = `translateX(${lPx}px)`;
    vLineR.style.transform = `translateX(${rPx}px)`;
    hLineT.style.transform = `translateY(${tPx}px)`;
    hLineB.style.transform = `translateY(${bPx}px)`;
    crossTL.style.top  = `calc(${t} - 10px)`;  crossTL.style.left = `calc(${l} - 10px)`;
    crossTR.style.top  = `calc(${t} - 10px)`;  crossTR.style.left = `calc(${r} - 10px)`;
    crossBL.style.top  = `calc(${b} - 10px)`;  crossBL.style.left = `calc(${l} - 10px)`;
    crossBR.style.top  = `calc(${b} - 10px)`;  crossBR.style.left = `calc(${r} - 10px)`;
    dotBg.style.left   = l;
    dotBg.style.top    = t;
    dotBg.style.width  = `calc(${r} - ${l})`;
    dotBg.style.height = `calc(${b} - ${t})`;
  });

  // ── File / URL handlers ────────────────────────────────────────────────────
  const [dragOver, setDragOver] = createSignal(false);
  const [hoveringBbox, setHoveringBbox] = createSignal(false);
  const [fetchStatus, setFetchStatus] = createSignal<string | null>(null);

  // ── Hover hint chips: text scrambles in on reveal ────────────────────────
  // Both lines start at their final value; each hover transition replays the
  // shared scrambleText util (same defaults as EditorView's chips). The
  // monospace font keeps chip width stable while characters resolve.
  const HINT_LINE_1 = 'DROP A FILE OR';
  const HINT_LINE_2 = 'PASTE A URL';
  const [hintLine1, setHintLine1] = createSignal(HINT_LINE_1);
  const [hintLine2, setHintLine2] = createSignal(HINT_LINE_2);
  let hintScrambleRaf = 0;
  createEffect(() => {
    if (!isIdle() || !hoveringBbox()) return;
    hintScrambleRaf = scrambleText(
      [
        { target: HINT_LINE_1, setter: setHintLine1 },
        { target: HINT_LINE_2, setter: setHintLine2 },
      ],
      hintScrambleRaf,
    );
  });
  onCleanup(() => cancelAnimationFrame(hintScrambleRaf));
  let fileInputRef!: HTMLInputElement;

  // Seed fps + width sliders from the source video's own metadata so opening
  // the settings panel shows the originals by default. Clamped to slider
  // ranges (fps 1..60, width 240..1920) — see VideoSettings.tsx tick defs.
  // Both `width` (GIF) and `vidWidth` (non-GIF) get the same value, so the
  // originals are pre-populated regardless of which output format the user
  // picks.
  const seedSourceDefaults = (metaFps?: number, metaWidth?: number) => {
    if (metaFps && metaFps > 0) {
      setAppState('fps', Math.max(1, Math.min(60, Math.round(metaFps))));
    }
    if (metaWidth && metaWidth > 0) {
      const w = Math.max(240, Math.min(1920, Math.round(metaWidth)));
      setAppState('width', w);
      setAppState('vidWidth', w);
    }
  };

  const handleFile = (file: File) => {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    const isGif = file.type === 'image/gif' || ext === 'gif';
    const isVideo = file.type.startsWith('video/');
    // Allow videos + GIFs only. Container formats without a MIME type (avi,
    // flv, wmv, ts, mkv on some browsers) fall through the MIME check, so
    // also accept known video extensions.
    const VIDEO_EXTS = new Set(['mp4','mov','mkv','webm','avi','flv','wmv','ts','mts','m4v','3gp','ogv']);
    if (!isGif && !isVideo && !VIDEO_EXTS.has(ext)) {
      setFetchStatus('Unsupported file — videos or GIFs only');
      setTimeout(() => setFetchStatus(null), 3000);
      return;
    }
    const objectUrl = URL.createObjectURL(file);

    // Probe dimensions client-side in parallel so the transition to EditorView
    // has fallback values if the server meta is missing a field. Server meta
    // (from ffprobe) is preferred when available — more reliable for formats
    // the browser can't decode natively (avi/flv/wmv/ts/…).
    const probeDims = (): Promise<{ w: number; h: number }> => {
      if (isGif) {
        return new Promise(resolve => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth || 1280, h: img.naturalHeight || 720 });
          img.onerror = () => resolve({ w: 1280, h: 720 });
          img.src = objectUrl;
        });
      }
      return new Promise(resolve => {
        const vid = document.createElement('video');
        vid.preload = 'metadata';
        vid.src = objectUrl;
        let done = false;
        const bail = () => { if (done) return; done = true; resolve({ w: 1280, h: 720 }); };
        const timer = setTimeout(bail, 1500);
        vid.onloadedmetadata = () => {
          if (done) return; done = true; clearTimeout(timer);
          resolve({ w: vid.videoWidth || 1280, h: vid.videoHeight || 720 });
        };
        vid.onerror = () => { clearTimeout(timer); bail(); };
      });
    };

    // Start the bar — bbox morphs from idle drop-zone into the 60vw × 80px bar.
    setPhase('loading');
    startPacedLoading();

    Promise.all([
      probeDims(),
      uploadFileWithProgress(file),
    ]).then(([dims, result]) => {
      if (!result) {
        stopPacedLoading();
        setFetchStatus('Upload failed');
        setTimeout(() => setFetchStatus(null), 3000);
        setPhase('idle');
        URL.revokeObjectURL(objectUrl);
        return;
      }
      // Real upload finished — queue transition. Pacer fires it after the
      // bar finishes its close-out animation (smooth HOLD_AT → 100).
      finishPacedLoading(() => {
        setAppState('uploadJobId',  result.jobId);
        setAppState('currentJobId', result.jobId);
        setAppState('uploadReady',  true);
        setAppState('inputFormat',  result.inputFormat);
        setAppState('needsProxy',   !!result.needsProxy);
        if (result.needsProxy) {
          waitForPreview(result.jobId).then(url => {
            if (url) setAppState('previewUrl', url);
          });
        }
        const w = result.meta?.width  || dims.w;
        const h = result.meta?.height || dims.h;
        seedSourceDefaults(result.meta?.fps, w);
        props.onVideoSelected({
          file, name: file.name, sizeBytes: file.size,
          width: w, height: h, objectUrl,
        });
      });
    });
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); if (!isLoading()) setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);
  const handleClick = () => { if (isIdle()) fileInputRef.click(); };

  const handleFileInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFile(file);
  };

  const handlePaste = async (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text');
    if (!text?.startsWith('http://') && !text?.startsWith('https://')) return;
    if (isLoading()) return; // another job already in flight

    // Start the bar — bbox morphs into the loading bar shape.
    setPhase('loading');
    startPacedLoading();

    const resetIdle = () => {
      stopPacedLoading();
      setPhase('idle');
    };

    try {
      const res = await fetch('/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text }),
      });
      if (!res.ok) {
        setFetchStatus('Failed to fetch URL');
        setTimeout(() => setFetchStatus(null), 3000);
        resetIdle();
        return;
      }
      const { jobId } = await res.json();

      // Listen for download progress via SSE. Server caps download progress
      // at 30 (line 143 of server.js), so stretch to 0-100 for the bar fill.
      const sse = new EventSource(`/progress/${jobId}`);
      sse.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.error) {
            sse.close();
            setFetchStatus(`Error: ${data.message ?? 'Download failed'}`);
            setTimeout(() => setFetchStatus(null), 3000);
            resetIdle();
            return;
          }
          if (data.status === 'downloaded') {
            sse.close();
            const meta = data.meta ?? {};
            finishPacedLoading(() => {
              setAppState('currentJobId', jobId);
              setAppState('uploadJobId', jobId);
              setAppState('uploadReady', true);
              setAppState('inputFormat', data.inputFormat ?? 'mp4');
              setAppState('needsProxy', !!data.needsProxy);
              seedSourceDefaults(meta.fps, meta.width);
              props.onVideoSelected({
                url: text,
                name: data.fileName ?? text.split('/').pop() ?? 'video',
                sizeBytes: data.inputSize ?? 0,
                width:  meta.width  || 1280,
                height: meta.height || 720,
                objectUrl: `/input/${jobId}`,
              });
            });
          }
        } catch { /* ignore */ }
      };
      sse.onerror = () => {
        sse.close();
        setFetchStatus('Connection error');
        setTimeout(() => setFetchStatus(null), 3000);
        resetIdle();
      };
    } catch {
      setFetchStatus('Failed to fetch URL');
      setTimeout(() => setFetchStatus(null), 3000);
      resetIdle();
    }
  };

  onMount(() => document.addEventListener('paste', handlePaste));
  onCleanup(() => document.removeEventListener('paste', handlePaste));

  return (
    <div
      ref={rootEl}
      style={{
        position: 'fixed', inset: '0', background: BG,
        cursor: isIdle() ? 'pointer' : 'default',
        overflow: 'hidden',
        opacity: dragOver() ? '0.8' : '1',
        transition: 'opacity 0.15s',
      }}
      onClick={handleClick}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* ── Dotted background inside bounding box ──────────────────────────
          Captures hover events so the center-cross hint label appears only
          when the cursor is actually inside the bbox (not anywhere on the
          page). pointer-events flips to 'none' outside the idle phase so
          the loading bar / drop handlers aren't shadowed. */}
      <div
        ref={dotBg}
        onMouseEnter={() => setHoveringBbox(true)}
        onMouseLeave={() => setHoveringBbox(false)}
        style={{
          position: 'absolute',
          left: SPLASH.GL, top: SPLASH.GT,
          width: `calc(${SPLASH.GR} - ${SPLASH.GL})`,
          height: `calc(${SPLASH.GB} - ${SPLASH.GT})`,
          'background-image': DOT_BG_IMAGE,
          'background-size': '32px 32px',
          'background-position': '50% 50%',
          opacity: '1',
          'pointer-events': isIdle() ? 'auto' : 'none',
        }}
      />

      {/* ── Guide lines ───────────────────────────────────────────────────── */}
      {/* Initial transforms seeded inline (in viewport units) so each line
          starts at its respective edge from the very first paint, not at
          translateX(0)/translateY(0) — otherwise both vertical lines would
          briefly appear at the left edge before onMount seeds them. */}
      <GuideLine orientation="v" ref={el => { vLineL = el; el.style.transform = 'translateX(2.8vw)'; }} />
      <GuideLine orientation="v" ref={el => { vLineR = el; el.style.transform = 'translateX(97.2vw)'; }} />
      <GuideLine orientation="h" ref={el => { hLineT = el; el.style.transform = 'translateY(6.13vh)'; }} />
      <GuideLine orientation="h" ref={el => { hLineB = el; el.style.transform = 'translateY(92.4vh)'; }} />

      {/* ── Corner crosshairs ─────────────────────────────────────────────── */}
      {/* Same rationale — seed initial top/left so each corner starts at its
          splash position rather than at viewport (0,0). */}
      <CornerCrosshair ref={el => { crossTL = el; el.style.top = 'calc(6.13vh - 10px)';  el.style.left = 'calc(2.8vw - 10px)';  }} />
      <CornerCrosshair ref={el => { crossTR = el; el.style.top = 'calc(6.13vh - 10px)';  el.style.left = 'calc(97.2vw - 10px)'; }} />
      <CornerCrosshair ref={el => { crossBL = el; el.style.top = 'calc(92.4vh - 10px)';  el.style.left = 'calc(2.8vw - 10px)';  }} />
      <CornerCrosshair ref={el => { crossBR = el; el.style.top = 'calc(92.4vh - 10px)';  el.style.left = 'calc(97.2vw - 10px)'; }} />

      {/* ── Center crosshair + hover hint (idle only) ─────────────────────
          Cross stays anchored at viewport center via top/left calc(50% - 10px).
          The hint label sits to the right of the cross in the same flex row,
          fading in only while the cursor is inside the bbox. The container is
          pointer-events: 'none' so it never intercepts hover detection on the
          dotted background underneath. */}
      <div style={{
        position: 'absolute',
        top: 'calc(50% - 10px)',
        left: 'calc(50% - 10px)',
        display: 'flex',
        'align-items': 'flex-start',
        gap: '8px',
        opacity: isIdle() ? '1' : '0',
        transition: 'opacity 0.3s ease',
        'pointer-events': 'none',
      }}>
        <Cross ref={el => centerCrossEl = el} />
        <div style={{
          display: 'flex',
          'flex-direction': 'column',
          'align-items': 'flex-start',
        }}>
          {/* Each chip sits inside a clip-path wrapper so the magenta bg
              sweeps in from the left on hover — matches the FormatButton
              dropdown's reveal (FORMAT_SPRING in editor/FormatPicker.tsx):
              200ms with a slight overshoot ease. clip-path: inset(0 100% 0 0)
              hides the chip; inset(0 0 0 0) reveals it left → right. */}
          <div style={{
            display: 'inline-block',
            'clip-path': isIdle() && hoveringBbox() ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
            transition: 'clip-path 200ms cubic-bezier(0.006, 0.984, 0.000, 1.109)',
          }}>
            <Chip>{hintLine1()}</Chip>
          </div>
          <div style={{
            display: 'inline-block',
            'clip-path': isIdle() && hoveringBbox() ? 'inset(0 0 0 0)' : 'inset(0 100% 0 0)',
            transition: 'clip-path 200ms cubic-bezier(0.006, 0.984, 0.000, 1.109)',
          }}>
            <Chip>{hintLine2()}</Chip>
          </div>
        </div>
      </div>

      {/* ── Loading bar (Option 5) — fills the morphed bbox while uploading
          a local file or fetching a URL. Position mirrors the loadingPos
          guides so it lines up with the bbox as it animates in. The fade-in
          is delayed by the full stagger duration (p1_dur + p2_delay + p2_dur)
          so the bar only appears once the bbox has finished morphing into
          its bar shape. Fade-out is immediate. ──────────────────────────── */}
      <div style={{
        position: 'absolute',
        left: loadingPos().gl,
        top:  loadingPos().gt,
        width:  `calc(${loadingPos().gr} - ${loadingPos().gl})`,
        height: `calc(${loadingPos().gb} - ${loadingPos().gt})`,
        opacity: isLoading() ? '1' : '0',
        transition: isLoading()
          ? `opacity ${p.helper_fade_dur}s ease ${STAGGER_P1 + STAGGER_DELAY + STAGGER_P2}s`
          : `opacity ${p.helper_fade_dur}s ease`,
        'pointer-events': isLoading() ? 'auto' : 'none',
      }}>
        <CarrierBricks progress={loadingProgress()} height={LOADING_BAR_H_PX} />
      </div>

      {/* ── URL fetch status ──────────────────────────────────────────────── */}
      <Show when={fetchStatus()}>
        <div style={{
          position: 'absolute', bottom: '24px', left: '50%', translate: '-50% 0',
          background: ACCENT, color: BG,
          'font-family': "'IBM Plex Mono', system-ui, monospace",
          'font-size': '12px', 'line-height': '16px', 'font-weight': '500',
          padding: '6px 14px',
          'pointer-events': 'none',
          'white-space': 'nowrap',
        }}>
          {fetchStatus()}
        </div>
      </Show>

      <input ref={fileInputRef} type="file" accept="video/*,image/gif,.mkv,.avi,.flv,.wmv,.ts,.mts,.m4v,.3gp,.ogv" style={{ display: 'none' }} onChange={handleFileInput} />
    </div>
  );
};

export default IdleView;
