import { Component, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { createDialKit } from 'dialkit/solid';
import type { VideoInfo } from '../../App';

// ── Guide positions ───────────────────────────────────────────────────────────
const SPLASH = { GL: '2.8%',  GR: '97.2%', GT: '6.13%', GB: '92.4%'  };
const IDLE   = { GL: '18.1%', GR: '81.9%', GT: '31.2%', GB: '68.8%' };

const ACCENT    = '#FC006D';
const ACCENT_75 = 'rgba(252,0,109,0.75)';
const BG        = '#F8F7F6';

type Phase = 'splash' | 'contracting' | 'idle';

// ── Logo SVG (asterisk) ───────────────────────────────────────────────────────
const Logo: Component<{ visible: boolean; dur: number; ease: string }> = (props) => (
  <svg
    width="200" height="197" viewBox="0 0 200 197" fill="none"
    xmlns="http://www.w3.org/2000/svg"
    style={{
      position: 'absolute',
      width: '340px', height: '335px',
      left: '50%', top: '50%',
      translate: '-50% -50%',
      'transform-origin': 'center center',
      transform: props.visible ? 'scale(1)' : 'scale(0)',
      opacity: props.visible ? '1' : '0',
      transition: `transform ${props.dur}s ${props.ease}, opacity ${props.dur}s ${props.ease}`,
      'pointer-events': 'none',
    }}
  >
    <rect x="108.272" y="24.496"  width="32.585" height="91.585" transform="rotate(21.776 108.272 24.496)"  fill={ACCENT} />
    <rect x="150.186" y="70.291"  width="32.585" height="72.928" transform="rotate(74.646 150.186 70.291)"  fill={ACCENT} />
    <rect x="113.537" y="94.55"   width="32.585" height="72.928" transform="rotate(92.851 113.537 94.55)"   fill={ACCENT} />
    <rect x="38.787"  y="50.697"  width="32.585" height="93.501" transform="rotate(-35.87 38.787 50.697)"   fill={ACCENT} />
    <rect x="90.667"  y="119.914" width="32.585" height="69.201" transform="rotate(-26.582 90.667 119.914)" fill={ACCENT} />
    <rect x="72.995"  y="165.832" width="32.585" height="58.34"  transform="rotate(-149.134 72.995 165.832)" fill={ACCENT} />
  </svg>
);

// ── Tracks whether the intro has already played this session ──────────────────
// Module-level so it survives IdleView unmount/remount (e.g. after pressing X),
// but resets on a full page reload (i.e. fresh app launch).
let hasLaunched = false;

// ── Main view ────────────────────────────────────────────────────────────────
const IdleView: Component<{ onVideoSelected: (info: VideoInfo) => void }> = (props) => {

  // ── Dials ──────────────────────────────────────────────────────────────────
  const p = createDialKit('Idle Screen', {
    phases: {
      splash_ms:   [700, 100, 6000, 100],  // how long the splash frame holds
      contract_ms: [100, 100, 3000, 50],   // duration of contraction to idle frame
    },
    guides: {
      dur: [0.3,  0.05, 3.0, 0.05],
      x1:  [0.8,  0.0,  1.0, 0.01],
      y1:  [0.0,  -1.0, 2.0, 0.01],
      x2:  [0.2,  0.0,  1.0, 0.01],
      y2:  [1.0,  -1.0, 2.0, 0.01],
    },
    logo: {
      dur: [0.3, 0.05, 3.0, 0.05],
    },
    text: {
      line1_dur:   [0.2,  0.05, 3.0, 0.05],
      line2_dur:   [0.2,  0.05, 3.0, 0.05],
      line2_delay: [0.1,  0.0,  3.0, 0.05],
      x1: [0.0,  0.0,  1.0, 0.01],
      y1: [1.0,  -1.0, 2.0, 0.01],
      x2: [0.28, 0.0,  1.0, 0.01],
      y2: [1.0,  -1.0, 2.0, 0.01],
    },
    helper_fade_dur: [0.1, 0.05, 2.0, 0.05],
    replay: { type: 'action' as const },
  }, {
    onAction: (path) => { if (path === 'replay') restartAnimation(); },
  });

  // ── Derived easing strings ─────────────────────────────────────────────────
  const guideEase = createMemo(() => {
    const { x1, y1, x2, y2 } = p().guides;
    return `cubic-bezier(${x1},${y1},${x2},${y2})`;
  });
  const textEase = createMemo(() => {
    const { x1, y1, x2, y2 } = p().text;
    return `cubic-bezier(${x1},${y1},${x2},${y2})`;
  });

  // ── Phase state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = createSignal<Phase>('splash');
  const isIdle = createMemo(() => phase() === 'idle');

  // Timeout refs so we can cancel and restart on replay
  let t1 = 0, t2 = 0;

  const startTimers = () => {
    clearTimeout(t1); clearTimeout(t2);
    const { splash_ms, contract_ms } = p().phases;
    t1 = setTimeout(() => setPhase('contracting'), splash_ms) as unknown as number;
    t2 = setTimeout(() => setPhase('idle'), splash_ms + contract_ms) as unknown as number;
  };

  const restartAnimation = () => {
    setPhase('splash');
    // Let the DOM reset to splash positions before re-running timers
    requestAnimationFrame(() => startTimers());
  };

  onMount(() => {
    if (hasLaunched) {
      setPhase('idle');
    } else {
      hasLaunched = true;
      startTimers();
    }
    onCleanup(() => { clearTimeout(t1); clearTimeout(t2); });
  });

  // ── DOM refs ───────────────────────────────────────────────────────────────
  let vLineL!: HTMLDivElement, vLineR!: HTMLDivElement;
  let hLineT!: HTMLDivElement, hLineB!: HTMLDivElement;
  let crossTL!: HTMLDivElement, crossTR!: HTMLDivElement;
  let crossBL!: HTMLDivElement, crossBR!: HTMLDivElement;

  // Guide positions driven by phase
  const gl = createMemo(() => phase() === 'splash' ? SPLASH.GL : IDLE.GL);
  const gr = createMemo(() => phase() === 'splash' ? SPLASH.GR : IDLE.GR);
  const gt = createMemo(() => phase() === 'splash' ? SPLASH.GT : IDLE.GT);
  const gb = createMemo(() => phase() === 'splash' ? SPLASH.GB : IDLE.GB);

  // Apply guide positions whenever phase or dial values change
  createEffect(() => {
    const l = gl(), r = gr(), t = gt(), b = gb();
    const tr = `${p().guides.dur}s ${guideEase()}`;
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
  });

  // ── File / URL handlers ────────────────────────────────────────────────────
  const [dragOver, setDragOver] = createSignal(false);
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

  const handlePaste = (e: ClipboardEvent) => {
    const text = e.clipboardData?.getData('text');
    if (text?.startsWith('http://') || text?.startsWith('https://')) {
      props.onVideoSelected({
        url: text,
        name: text.split('/').pop() ?? 'video',
        sizeBytes: 0,
        width: 16,
        height: 9,
        objectUrl: text,
      });
    }
  };

  onMount(() => document.addEventListener('paste', handlePaste));
  onCleanup(() => document.removeEventListener('paste', handlePaste));

  const armV = { position: 'absolute' as const, left: '9px', top: '0',  width: '2px',  height: '20px', background: ACCENT };
  const armH = { position: 'absolute' as const, left: '0',  top: '9px', width: '20px', height: '2px',  background: ACCENT };

  return (
    <div
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

      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <Logo visible={phase() === 'splash'} dur={p().logo.dur} ease={guideEase()} />

      {/* ── Idle content ──────────────────────────────────────────────────── */}
      <div style={{ position: 'absolute', top: 'calc(50% - 40px)', left: 'calc(50% - 68.5px)', translate: '-50% -50%', display: 'flex', 'flex-direction': 'column', 'align-items': 'flex-start' }}>
        {/* Line 1 */}
        <div style={{
          display: 'inline-flex', 'align-items': 'center', background: ACCENT,
          'clip-path': 'inset(0 100% 0 0)',
          animation: isIdle()
            ? `label-highlight ${p().text.line1_dur}s ${textEase()} forwards`
            : 'none',
        }}>
          <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-size': '24px', 'line-height': '30px', 'font-weight': '400', color: BG }}>DROP A FILE</span>
        </div>
        {/* Line 2 */}
        <div style={{
          display: 'inline-flex', 'align-items': 'center', background: ACCENT,
          'clip-path': 'inset(0 100% 0 0)',
          animation: isIdle()
            ? `label-highlight ${p().text.line2_dur}s ${textEase()} ${p().text.line2_delay}s forwards`
            : 'none',
        }}>
          <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-size': '24px', 'line-height': '30px', 'font-weight': '400', color: BG }}>OR URL</span>
        </div>
      </div>

      {/* ── Helper text ───────────────────────────────────────────────────── */}
      <div style={{
        position: 'absolute', top: '63.47%', left: '50%', translate: '-50% 0',
        display: 'flex', 'flex-direction': 'column', 'align-items': 'center',
        opacity: isIdle() ? '1' : '0',
        transition: `opacity ${p().helper_fade_dur}s ease`,
      }}>
        <span style={{ 'font-family': "'IBM Plex Mono', system-ui, monospace", 'font-weight': '500', 'font-size': '12px', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>click to browse - max 500mb</span>
        <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-weight': '500', 'font-size': '12px', 'line-height': '16px', color: ACCENT, 'white-space': 'nowrap' }}>ctrl+v anywhere to paste URL</span>
      </div>

      <input ref={fileInputRef} type="file" accept="video/*,image/gif,image/*" style={{ display: 'none' }} onChange={handleFileInput} />
    </div>
  );
};

export default IdleView;
