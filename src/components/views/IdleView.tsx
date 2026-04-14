import { Component, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import type { VideoInfo } from '../../App';
import { calculateBBoxTargets } from '../../engine/bbox-calc';
import { setAppState } from '../../state/app';

// ── Guide positions ───────────────────────────────────────────────────────────
const SPLASH = { GL: '2.8%',  GR: '97.2%', GT: '6.13%', GB: '92.4%'  };

const pct = (v: number, of: number) => (v / of * 100).toFixed(4) + '%';

// Compute idle bounding box guide percentages from actual viewport dimensions.
// Uses the same logic as bbox-calc.ts so the idle box is always properly centered
// and aspect-ratio-constrained regardless of window size.
function computeIdlePos(vw: number, vh: number) {
  const { x1, y1, x2, y2 } = calculateBBoxTargets(vw, vh, null, 'idle');
  return {
    gl: pct(x1, vw), gr: pct(x2, vw),
    gt: pct(y1, vh), gb: pct(y2, vh),
    // Helper text: positioned 85.8% down the box height (preserves original design ratio)
    helperTop: (y1 + (y2 - y1) * 0.858) + 'px',
  };
}

import { ACCENT, ACCENT_75, BG } from '../../shared/tokens';

type Phase = 'splash' | 'contracting' | 'idle';

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

  // ── Phase state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = createSignal<Phase>(hasLaunched ? 'idle' : 'splash');
  const isIdle = createMemo(() => phase() === 'idle');

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

  // Guide positions driven by phase — idle positions are computed from live viewport size
  const gl = createMemo(() => phase() === 'splash' ? SPLASH.GL : idlePos().gl);
  const gr = createMemo(() => phase() === 'splash' ? SPLASH.GR : idlePos().gr);
  const gt = createMemo(() => phase() === 'splash' ? SPLASH.GT : idlePos().gt);
  const gb = createMemo(() => phase() === 'splash' ? SPLASH.GB : idlePos().gb);

  // When remounting after a video cancel, skip the first transition so
  // guide lines and crosshairs don't animate from SPLASH to idle out of sync.
  let skipTransition = hasLaunched;

  // Apply guide positions whenever phase or dial values change
  createEffect(() => {
    const l = gl(), r = gr(), t = gt(), b = gb();
    const dur = skipTransition ? '0s' : `${p.guides.dur}s`;
    const tr = `${dur} ${guideEase}`;
    if (skipTransition) skipTransition = false;
    vLineL.style.transition = `left ${tr}`;
    vLineR.style.transition = `left ${tr}`;
    hLineT.style.transition = `top ${tr}`;
    hLineB.style.transition = `top ${tr}`;
    [crossTL, crossTR, crossBL, crossBR].forEach(el => {
      el.style.transition = `top ${tr}, left ${tr}`;
    });
    vLineL.style.left = l;   vLineR.style.left = r;
    hLineT.style.top  = t;   hLineB.style.top  = b;
    crossTL.style.top  = `calc(${t} - 10px)`;  crossTL.style.left = `calc(${l} - 10px)`;
    crossTR.style.top  = `calc(${t} - 10px)`;  crossTR.style.left = `calc(${r} - 10px)`;
    crossBL.style.top  = `calc(${b} - 10px)`;  crossBL.style.left = `calc(${l} - 10px)`;
    crossBR.style.top  = `calc(${b} - 10px)`;  crossBR.style.left = `calc(${r} - 10px)`;
    dotBg.style.transition = `left ${tr}, top ${tr}, width ${tr}, height ${tr}, opacity ${tr}`;
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
    const objectUrl = URL.createObjectURL(file);
    const vid = document.createElement('video');
    vid.preload = 'metadata';
    vid.src = objectUrl;
    vid.onloadedmetadata = () => {
      props.onVideoSelected({
        file,
        name: file.name,
        sizeBytes: file.size,
        width: vid.videoWidth,
        height: vid.videoHeight,
        objectUrl,
      });
    };
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer?.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: DragEvent) => { e.preventDefault(); setDragOver(true); };
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

    setFetchStatus('Fetching…');
    try {
      const res = await fetch('/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: text }),
      });
      if (!res.ok) { setFetchStatus('Failed to fetch URL'); return; }
      const { jobId } = await res.json();

      // Listen for download progress via SSE
      const sse = new EventSource(`/progress/${jobId}`);
      sse.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data.message) setFetchStatus(data.message);
          if (data.error) {
            sse.close();
            setFetchStatus(`Error: ${data.message ?? 'Download failed'}`);
            setTimeout(() => setFetchStatus(null), 3000);
            return;
          }
          if (data.status === 'downloaded') {
            sse.close();
            setFetchStatus(null);
            const meta = data.meta ?? {};
            // Store job id in app state so EditorView picks it up
            setAppState('currentJobId', jobId);
            props.onVideoSelected({
              url: text,
              name: data.fileName ?? text.split('/').pop() ?? 'video',
              sizeBytes: data.inputSize ?? 0,
              width:  meta.width  || 1280,
              height: meta.height || 720,
              objectUrl: `/input/${jobId}`,
            });
          }
        } catch { /* ignore */ }
      };
      sse.onerror = () => {
        sse.close();
        setFetchStatus('Connection error');
        setTimeout(() => setFetchStatus(null), 3000);
      };
    } catch {
      setFetchStatus('Failed to fetch URL');
      setTimeout(() => setFetchStatus(null), 3000);
    }
  };

  onMount(() => document.addEventListener('paste', handlePaste));
  onCleanup(() => document.removeEventListener('paste', handlePaste));

  const armV = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px',  height: '20px', background: ACCENT };
  const armH = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px',  background: ACCENT };

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
      <div ref={vLineL} style={{ position: 'absolute', top: '0', bottom: '0', left: SPLASH.GL, width: '1px', background: ACCENT_75 }} />
      <div ref={vLineR} style={{ position: 'absolute', top: '0', bottom: '0', left: SPLASH.GR, width: '1px', background: ACCENT_75 }} />
      <div ref={hLineT} style={{ position: 'absolute', left: '0', right: '0', top: SPLASH.GT,  height: '1px', background: ACCENT_75 }} />
      <div ref={hLineB} style={{ position: 'absolute', left: '0', right: '0', top: SPLASH.GB,  height: '1px', background: ACCENT_75 }} />

      {/* ── Corner crosshairs ─────────────────────────────────────────────── */}
      <div ref={crossTL} style={{ position: 'absolute', width: '20px', height: '20px' }}><div style={armV} /><div style={armH} /></div>
      <div ref={crossTR} style={{ position: 'absolute', width: '20px', height: '20px' }}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBL} style={{ position: 'absolute', width: '20px', height: '20px' }}><div style={armV} /><div style={armH} /></div>
      <div ref={crossBR} style={{ position: 'absolute', width: '20px', height: '20px' }}><div style={armV} /><div style={armH} /></div>

      {/* ── Center crosshair (idle only) ──────────────────────────────────── */}
      <div style={{ position: 'absolute', width: '20px', height: '20px', top: 'calc(50% - 10px)', left: 'calc(50% - 10px)', opacity: isIdle() ? '1' : '0', transition: 'opacity 0.3s ease' }}>
        <div style={armV} /><div style={armH} />
      </div>

      {/* ── Helper text ───────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: idlePos().helperTop, left: '50%', translate: '-50% 0',
        display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
        opacity: isIdle() ? '1' : '0',
        transition: `opacity ${p.helper_fade_dur}s ease`,
      }}>
        <span style={{ 'font-family': "'IBM Plex Mono', system-ui, monospace", 'font-weight': '500', 'font-size': '12px', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>DROP A FILE OR URL</span>
        <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-weight': '500', 'font-size': '12px', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>click to browse or ctrl+v anywhere</span>
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

      <input ref={fileInputRef} type="file" accept="video/*,image/gif,image/*" style={{ display: 'none' }} onChange={handleFileInput} />
    </div>
  );
};

export default IdleView;
