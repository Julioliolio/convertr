import { Component, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import { setAppState } from '../../state/app';
import { uploadFileWithProgress, waitForPreview } from '../../api/upload';
import { pct } from '../../shared/utils';
import CarrierBricks from '../loading/CarrierBricks';

// ── Guide positions ───────────────────────────────────────────────────────────
const SPLASH = { GL: '2.8%',  GR: '97.2%', GT: '6.13%', GB: '92.4%'  };

// Compute idle bounding box guide percentages from actual viewport dimensions.
// Uses the same logic as bbox-calc.ts so the idle box is always properly centered
// and aspect-ratio-constrained regardless of window size.
function computeIdlePos(vw: number, vh: number) {
  const { x1, y1, x2, y2 } = calculateBBoxTargets(vw, vh, null, 'idle');
  return {
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
    gl: pct(x1, vw), gr: pct(x2, vw),
    gt: pct(y1, vh), gb: pct(y2, vh),
    helperBottom: (vh - y2 + 16) + 'px',
  };
}

import { ACCENT, BG } from '../../shared/tokens';
import { Cross, CornerCrosshair, GuideLine } from '../../shared/ui';

type Phase = 'splash' | 'contracting' | 'idle' | 'loading';

// ── Tracks whether the intro has already played this session ──────────────────
// Module-level so it survives IdleView unmount/remount (e.g. after pressing X),
// but resets on a full page reload (i.e. fresh app launch).
let hasLaunched = false;

// ── Main view ────────────────────────────────────────────────────────────────
const IdleView: Component<{ onVideoSelected: (info: VideoInfo) => void }> = (props) => {

  // ── Static config ────────────────────────────────────────────────────────────
  const p = {
    phases: { splash_ms: 700, contract_ms: 100 },
    guides: { dur: 0.3, x1: 0.8, y1: 0.0, x2: 0.2, y2: 1.0 },
    logo:   { dur: 0.3 },
    text:   { line1_dur: 0.2, line2_dur: 0.2, line2_delay: 0.1, x1: 0.0, y1: 1.0, x2: 0.28, y2: 1.0 },
    helper_fade_dur: 0.1,
  };

  const guideEase = `cubic-bezier(${p.guides.x1},${p.guides.y1},${p.guides.x2},${p.guides.y2})`;
  const textEase = `cubic-bezier(${p.text.x1},${p.text.y1},${p.text.x2},${p.text.y2})`;

  // ── Viewport size (drives responsive idle bbox) ────────────────────────────
  const [vp, setVp] = createSignal({ vw: 0, vh: 0 });
  const idlePos = createMemo(() => {
    const { vw, vh } = vp();
    if (vw <= 0 || vh <= 0) return computeIdlePos(1, 1); // safe fallback
    return computeIdlePos(vw, vh);
  });
  const loadingPos = createMemo(() => {
    const { vw, vh } = vp();
    if (vw <= 0 || vh <= 0) return computeLoadingPos(1, 1);
    return computeLoadingPos(vw, vh);
  });

  // ── Phase state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = createSignal<Phase>(hasLaunched ? 'idle' : 'splash');
  const isIdle = createMemo(() => phase() === 'idle');
  const isLoading = createMemo(() => phase() === 'loading');

  // ── Loading bar (time-driven, continuous) ────────────────────────────────
  // One seamless ramp from 0 → 100. The pacer starts once the bbox → bar
  // morph has completed (BAR_FADE_MS) so the bar appears at 0%, not mid-
  // fill. Animates 0 → HOLD_AT over ANIMATE_MS (ease-out), holds there
  // until the real job reports done, then closes HOLD_AT → 100 over
  // FINISH_MS before firing the transition to EditorView. No gate resets,
  // no smoothing jumps — single continuous animation.
  const BAR_FADE_MS = 1050; // = (STAGGER_P1 + STAGGER_DELAY + STAGGER_P2) * 1000
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

  onMount(() => {
    if (!hasLaunched) {
      hasLaunched = true;
      startTimers();
    }
    onCleanup(() => { clearTimeout(t1); clearTimeout(t2); });

    // Track viewport size so idle bbox stays responsive on resize
    setVp({ vw: rootEl.offsetWidth, vh: rootEl.offsetHeight });
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
  let skipTransition = hasLaunched;

  // Apply guide positions whenever phase or dial values change.
  // Staggered p1/p2 rhythm: horizontal axis (left) unfolds first, vertical
  // axis (top) follows after p2_delay — matches the cinematic principle used
  // by the editor. Skipped on the initial remount after a video cancel so
  // the lines don't flicker from SPLASH → idle.
  const STAGGER_P1 = 0.35;
  const STAGGER_P2 = 0.35;
  const STAGGER_DELAY = 0.35;
  createEffect(() => {
    const l = gl(), r = gr(), t = gt(), b = gb();
    const skip = skipTransition;
    if (skipTransition) skipTransition = false;
    const trLeft = skip ? `0s ${guideEase}` : `${STAGGER_P1}s ${guideEase}`;
    const trTop  = skip ? `0s ${guideEase}` : `${STAGGER_P2}s ${guideEase} ${STAGGER_DELAY}s`;
    vLineL.style.transition = `left ${trLeft}`;
    vLineR.style.transition = `left ${trLeft}`;
    hLineT.style.transition = `top ${trTop}`;
    hLineB.style.transition = `top ${trTop}`;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => {
      el.style.transition = `top ${trTop}, left ${trLeft}`;
    });
    vLineL.style.left = l;   vLineR.style.left = r;
    hLineT.style.top  = t;   hLineB.style.top  = b;
    crossTL.style.top  = `calc(${t} - 10px)`;  crossTL.style.left = `calc(${l} - 10px)`;
    crossTR.style.top  = `calc(${t} - 10px)`;  crossTR.style.left = `calc(${r} - 10px)`;
    crossBL.style.top  = `calc(${b} - 10px)`;  crossBL.style.left = `calc(${l} - 10px)`;
    crossBR.style.top  = `calc(${b} - 10px)`;  crossBR.style.left = `calc(${r} - 10px)`;
    // Dot bg rides the same stagger: left/width on the horizontal phase,
    // top/height on the vertical phase.
    dotBg.style.transition = `left ${trLeft}, width ${trLeft}, top ${trTop}, height ${trTop}, opacity ${trLeft}`;
    dotBg.style.left   = l;
    dotBg.style.top    = t;
    dotBg.style.width  = `calc(${r} - ${l})`;
    dotBg.style.height = `calc(${b} - ${t})`;
  });

  // ── File / URL handlers ────────────────────────────────────────────────────
  const [dragOver, setDragOver] = createSignal(false);
  const [fetchStatus, setFetchStatus] = createSignal<string | null>(null);
  let fileInputRef!: HTMLInputElement;

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
      {/* ── Dotted background inside bounding box ────────────────────────── */}
      <div
        ref={dotBg}
        style={{
          position: 'absolute',
          left: SPLASH.GL, top: SPLASH.GT,
          width: `calc(${SPLASH.GR} - ${SPLASH.GL})`,
          height: `calc(${SPLASH.GB} - ${SPLASH.GT})`,
          'background-image': 'radial-gradient(circle, rgba(252,0,109,0.5) 1px, transparent 1px)',
          'background-size': '32px 32px',
          'background-position': '50% 50%',
          opacity: '1',
          'pointer-events': 'none',
        }}
      />

      {/* ── Guide lines ───────────────────────────────────────────────────── */}
      <GuideLine orientation="v" ref={el => { vLineL = el; el.style.left = SPLASH.GL; }} />
      <GuideLine orientation="v" ref={el => { vLineR = el; el.style.left = SPLASH.GR; }} />
      <GuideLine orientation="h" ref={el => { hLineT = el; el.style.top  = SPLASH.GT; }} />
      <GuideLine orientation="h" ref={el => { hLineB = el; el.style.top  = SPLASH.GB; }} />

      {/* ── Corner crosshairs ─────────────────────────────────────────────── */}
      <CornerCrosshair ref={el => crossTL = el} />
      <CornerCrosshair ref={el => crossTR = el} />
      <CornerCrosshair ref={el => crossBL = el} />
      <CornerCrosshair ref={el => crossBR = el} />

      {/* ── Center crosshair (idle only) ──────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 'calc(50% - 10px)', left: 'calc(50% - 10px)', opacity: isIdle() ? '1' : '0', transition: 'opacity 0.3s ease' }}>
        <Cross />
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

      {/* ── Helper text ───────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', bottom: idlePos().helperBottom,
        left: idlePos().gl, right: `calc(100% - ${idlePos().gr})`,
        display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
        'text-align': 'center',
        overflow: 'hidden',
        opacity: isIdle() ? '1' : '0',
        transition: `opacity ${p.helper_fade_dur}s ease`,
      }}>
        <span style={{ 'font-family': "'IBM Plex Mono', system-ui, monospace", 'font-weight': '500', 'font-size': 'clamp(9px, 2vw, 12px)', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>DROP A FILE OR URL</span>
        <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-weight': '500', 'font-size': 'clamp(9px, 2vw, 12px)', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>click to browse or ctrl+v anywhere</span>
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
