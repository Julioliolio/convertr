import { Component, For, Show, createSignal, onCleanup, onMount } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { Chip, CornerCrosshair } from '../../shared/ui';
import SolidFill from './bars/SolidFill';
import BrickFill from './bars/BrickFill';
import ControlMatrix from './bars/ControlMatrix';
import HexRain from './bars/HexRain';
import CarrierBricks from './bars/CarrierBricks';
import AsciiStorm from './bars/AsciiStorm';
import { formatBytes, formatDuration, type BarTelemetry, type BarVariantComponent } from './bars/common';

interface Variant {
  id: string;
  label: string;
  tagline: string;
  Bar: BarVariantComponent;
}

const VARIANTS: Variant[] = [
  { id: '1', label: '01 · SOLID FILL',      tagline: 'baseline — flat fill + big %', Bar: SolidFill },
  { id: '2', label: '02 · BRICK FILL',      tagline: 'Image 2 — chunky segmented bricks', Bar: BrickFill },
  { id: '3', label: '03 · CONTROL MATRIX',  tagline: 'Image 1 — progress rail + NET STATUS / CODEC LOG', Bar: ControlMatrix },
  { id: '4', label: '04 · HEX RAIN',        tagline: 'Image 1 — shimmering hex dump', Bar: HexRain },
  { id: '5', label: '05 · CARRIER × BRICKS',tagline: 'hybrid — sine wave + brick fill', Bar: CarrierBricks },
  { id: '6', label: '06 · ASCII STORM',     tagline: 'hybrid — scrambled ASCII resolving', Bar: AsciiStorm },
];

// Fake progress generator that ramps 0→100 over DURATION ms, lingers briefly,
// then restarts.
const DURATION = 6000;
const HOLD = 800;

const BarPlayground: Component = () => {
  // ── Looping progress signal (drives the stacked preview strip) ─────────────
  const [progress, setProgress] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  let rafId = 0;
  const loopStart = performance.now();
  onMount(() => {
    const tick = (now: number) => {
      if (!paused()) {
        const elapsed = (now - loopStart) % (DURATION + HOLD);
        if (elapsed < DURATION) {
          setProgress((elapsed / DURATION) * 100);
        } else {
          setProgress(100);
        }
      }
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  });
  onCleanup(() => cancelAnimationFrame(rafId));

  // ── Bar dimension sliders ──────────────────────────────────────────────────
  // These drive the bar target size everywhere in the playground (top morph
  // demo, full-flow demo, and the bottom preview strip).
  const [barWidthVw, setBarWidthVw] = createSignal(60);
  const [barHeightPx, setBarHeightPx] = createSignal(80);

  // ── Preview-strip telemetry ────────────────────────────────────────────────
  // Derived from the looping `progress` signal. The preview lane is split:
  // the first half of the loop is an upload pass (bytes), the second is a
  // process pass (frames / fps / bitrate / eta). Variants that consume
  // telemetry (ControlMatrix) see real-feeling numbers instead of flavor.
  const PREVIEW_BYTES_TOTAL = 42_800_000;
  const PREVIEW_FRAMES_TOTAL = 8520;
  const PREVIEW_PROCESS_MS = 5400;
  const PREVIEW_UPLOAD_MS = 3800;
  const previewTelemetry = (): BarTelemetry => {
    const p = progress(); // 0..100
    if (p < 50) {
      const t = p / 50;
      return {
        phase: 'upload',
        elapsedMs: t * PREVIEW_UPLOAD_MS,
        bytesDone: Math.floor(t * PREVIEW_BYTES_TOTAL),
        bytesTotal: PREVIEW_BYTES_TOTAL,
      };
    }
    const t = (p - 50) / 50;
    return {
      phase: 'process',
      elapsedMs: t * PREVIEW_PROCESS_MS,
      framesDone: Math.floor(t * PREVIEW_FRAMES_TOTAL),
      framesTotal: PREVIEW_FRAMES_TOTAL,
      fps: 58 + Math.sin(t * 18) * 9,
      bitrateKbps: 3200 + Math.sin(t * 13) * 420,
      etaMs: Math.max(0, (1 - t) * PREVIEW_PROCESS_MS),
      speedX: 2.1 + Math.sin(t * 11) * 0.3,
    };
  };
  const previewProgress = () => {
    const p = progress();
    return p < 50 ? (p / 50) * 100 : ((p - 50) / 50) * 100;
  };

  // ── Morph demo ─────────────────────────────────────────────────────────────
  type MorphState = 'idle' | 'loading' | 'done';
  const [morph, setMorph] = createSignal<MorphState>('idle');
  const [morphProgress, setMorphProgress] = createSignal(0);
  const [demoVariantIdx, setDemoVariantIdx] = createSignal(2);
  let morphRaf = 0;
  const SLOW = new URLSearchParams(window.location.search).get('slow') === '1';
  const MORPH_DURATION = SLOW ? 22000 : 4200;
  const MORPH_CSS = SLOW ? '4500ms' : '600ms';
  const DONE_HOLD = SLOW ? 10000 : 2400;

  const runMorphDemo = () => {
    if (morph() !== 'idle') return;
    setMorph('loading');
    setMorphProgress(0);
    const morphStart = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - morphStart) / MORPH_DURATION);
      setMorphProgress(t * 100);
      if (t >= 1) {
        setMorph('done');
        setTimeout(() => setMorph('idle'), DONE_HOLD);
        return;
      }
      morphRaf = requestAnimationFrame(tick);
    };
    morphRaf = requestAnimationFrame(tick);
  };
  onCleanup(() => cancelAnimationFrame(morphRaf));

  const currentVariant = () => VARIANTS[demoVariantIdx()];

  const isBar = () => morph() === 'loading';
  const bboxWidth  = () => isBar() ? `${barWidthVw()}vw` : '800px';
  const bboxHeight = () => isBar() ? `${barHeightPx()}px` : '450px';

  // ── Full-flow demo (import → upload → settings → process → result) ────────
  // Only variants 1, 3, 5 per the brief.
  const FLOW_VARIANTS = [0, 2, 4];
  type FlowScene = 'idle' | 'import' | 'uploading' | 'settings' | 'processing' | 'result';
  const [flowScene, setFlowScene] = createSignal<FlowScene>('idle');
  const [flowVariantIdx, setFlowVariantIdx] = createSignal(2);
  const [uploadPct, setUploadPct] = createSignal(0);
  const [processPct, setProcessPct] = createSignal(0);
  const [flowTelemetry, setFlowTelemetry] = createSignal<BarTelemetry | undefined>(undefined);
  let flowInterval: number | undefined;
  let flowTimer: number | undefined;

  const FLOW_TIMINGS = SLOW
    ? { import: 2000, uploading: 12000, settings: 4000, processing: 18000, result: 6000 }
    : { import: 1200, uploading: 3800, settings: 2200, processing: 5400, result: 3200 };

  const clearFlowTimers = () => {
    if (flowInterval) { clearInterval(flowInterval); flowInterval = undefined; }
    if (flowTimer) { clearTimeout(flowTimer); flowTimer = undefined; }
  };
  onCleanup(clearFlowTimers);

  const runFullFlow = () => {
    if (flowScene() !== 'idle') return;
    setFlowScene('import');
    flowTimer = window.setTimeout(startUploading, FLOW_TIMINGS.import);
  };

  const startUploading = () => {
    const totalBytes = 42_800_000; // 42.8MB "video.mov"
    const start = performance.now();
    setFlowScene('uploading');
    setUploadPct(0);
    flowInterval = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / FLOW_TIMINGS.uploading);
      setUploadPct(t * 100);
      setFlowTelemetry({
        phase: 'upload',
        elapsedMs: elapsed,
        bytesDone: Math.floor(t * totalBytes),
        bytesTotal: totalBytes,
      });
      if (t >= 1) {
        if (flowInterval) { clearInterval(flowInterval); flowInterval = undefined; }
        flowTimer = window.setTimeout(startSettings, 220);
      }
    }, 40);
  };

  const startSettings = () => {
    setFlowScene('settings');
    setFlowTelemetry(undefined);
    flowTimer = window.setTimeout(startProcessing, FLOW_TIMINGS.settings);
  };

  const startProcessing = () => {
    const totalFrames = 8520;
    const start = performance.now();
    setFlowScene('processing');
    setProcessPct(0);
    flowInterval = window.setInterval(() => {
      const elapsed = performance.now() - start;
      const t = Math.min(1, elapsed / FLOW_TIMINGS.processing);
      setProcessPct(t * 100);
      setFlowTelemetry({
        phase: 'process',
        elapsedMs: elapsed,
        framesDone: Math.floor(t * totalFrames),
        framesTotal: totalFrames,
        fps: 58 + Math.sin(elapsed / 300) * 9,
        bitrateKbps: 3200 + Math.sin(elapsed / 400) * 420,
        etaMs: Math.max(0, FLOW_TIMINGS.processing - elapsed),
        speedX: 2.1 + Math.sin(elapsed / 500) * 0.3,
      });
      if (t >= 1) {
        if (flowInterval) { clearInterval(flowInterval); flowInterval = undefined; }
        flowTimer = window.setTimeout(startResult, 220);
      }
    }, 40);
  };

  const startResult = () => {
    setFlowScene('result');
    setFlowTelemetry(undefined);
    flowTimer = window.setTimeout(() => setFlowScene('idle'), FLOW_TIMINGS.result);
  };

  const resetFlow = () => {
    clearFlowTimers();
    setFlowScene('idle');
    setUploadPct(0);
    setProcessPct(0);
    setFlowTelemetry(undefined);
  };

  // Flow stage bbox dimensions per scene
  const flowBboxWidth = () => {
    const s = flowScene();
    if (s === 'uploading' || s === 'processing') return `${barWidthVw()}vw`;
    if (s === 'settings' || s === 'result') return '800px';
    if (s === 'import') return '1000px';
    return '1000px';
  };
  const flowBboxHeight = () => {
    const s = flowScene();
    if (s === 'uploading' || s === 'processing') return `${barHeightPx()}px`;
    if (s === 'settings' || s === 'result') return '450px';
    if (s === 'import') return '540px';
    return '540px';
  };
  const flowIsBar = () => flowScene() === 'uploading' || flowScene() === 'processing';
  const flowIsImport = () => flowScene() === 'import' || flowScene() === 'idle';
  const flowIsVideoBox = () => flowScene() === 'settings' || flowScene() === 'result';
  const flowPct = () => flowScene() === 'uploading' ? uploadPct() : processPct();
  const currentFlowVariant = () => VARIANTS[flowVariantIdx()];

  // ── Shared styles helper block ─────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: '0', background: BG,
      'font-family': MONO, color: ACCENT,
      overflow: 'auto',
    }}>
      <style>{`
        .pg-btn {
          background: ${ACCENT}; color: ${BG};
          font-family: ${MONO}; font-size: 12px; line-height: 16px;
          padding: 6px 10px; border: none; cursor: pointer;
          letter-spacing: 0.04em;
        }
        .pg-btn:disabled { opacity: 0.45; cursor: default; }
        .pg-btn-ghost {
          background: transparent; color: ${ACCENT};
          border: 1px solid ${ACCENT};
        }
        .pg-variant-chip { cursor: pointer; transition: opacity 0.15s ease; }
        .pg-variant-chip.inactive { opacity: 0.4; }
        .pg-variant-chip:hover { opacity: 1; }
        .pg-slider {
          -webkit-appearance: none; appearance: none;
          width: 160px; height: 2px;
          background: rgba(252,0,109,0.3);
          outline: none;
          cursor: pointer;
        }
        .pg-slider::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 12px; height: 12px;
          background: ${ACCENT}; border: 0;
          cursor: pointer;
        }
        .pg-slider::-moz-range-thumb {
          width: 12px; height: 12px; background: ${ACCENT};
          border: 0; cursor: pointer;
        }
        @keyframes pg-pulse {
          0%,100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={{ padding: '24px 32px', display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', 'border-bottom': `1px solid rgba(252,0,109,0.25)` }}>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
          <Chip size="xs">LOADING BAR LAB</Chip>
          <span style={{ 'font-size': '11px', opacity: '0.65' }}>6 propositions · bbox → bar → bbox</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
          <button class="pg-btn pg-btn-ghost" onClick={() => setPaused(p => !p)}>{paused() ? '▶ resume' : '⏸ pause'}</button>
          <a href="?" class="pg-btn pg-btn-ghost" style={{ 'text-decoration': 'none', display: 'inline-flex', 'align-items': 'center' }}>← exit lab</a>
        </div>
      </div>

      {/* ── Bar dimension sliders ─────────────────────────────────────────── */}
      <div style={{ padding: '16px 32px', 'border-bottom': `1px solid rgba(252,0,109,0.25)`, display: 'flex', gap: '32px', 'align-items': 'center', 'flex-wrap': 'wrap' }}>
        <Chip size="xs">BAR SIZE</Chip>
        <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
          <span style={{ 'font-size': '10px', opacity: '0.7', 'min-width': '56px' }}>WIDTH</span>
          <input
            class="pg-slider"
            type="range"
            min="30" max="90" step="1"
            value={barWidthVw()}
            onInput={e => setBarWidthVw(parseInt((e.currentTarget as HTMLInputElement).value))}
          />
          <span style={{ 'font-size': '11px', 'font-variant-numeric': 'tabular-nums', 'min-width': '48px' }}>{barWidthVw()}vw</span>
        </div>
        <div style={{ display: 'flex', gap: '12px', 'align-items': 'center' }}>
          <span style={{ 'font-size': '10px', opacity: '0.7', 'min-width': '56px' }}>HEIGHT</span>
          <input
            class="pg-slider"
            type="range"
            min="48" max="180" step="2"
            value={barHeightPx()}
            onInput={e => setBarHeightPx(parseInt((e.currentTarget as HTMLInputElement).value))}
          />
          <span style={{ 'font-size': '11px', 'font-variant-numeric': 'tabular-nums', 'min-width': '48px' }}>{barHeightPx()}px</span>
        </div>
        <button class="pg-btn pg-btn-ghost" onClick={() => { setBarWidthVw(60); setBarHeightPx(80); }}>reset</button>
      </div>

      {/* ── Morph demo (single bbox ↔ bar) ───────────────────────────────── */}
      <div style={{ padding: '32px', 'border-bottom': `1px solid rgba(252,0,109,0.25)`, background: BG }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '20px' }}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <Chip size="xs">MORPH DEMO</Chip>
            <span style={{ 'font-size': '11px', opacity: '0.65' }}>click RUN — bbox collapses into the bar, then morphs back</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
            <For each={VARIANTS}>{(v, i) => (
              <div
                class="pg-variant-chip"
                classList={{ inactive: i() !== demoVariantIdx() }}
                onClick={() => setDemoVariantIdx(i())}
              >
                <Chip size="xs">{v.id}</Chip>
              </div>
            )}</For>
            <button
              class="pg-btn"
              onClick={runMorphDemo}
              disabled={morph() !== 'idle'}
              style={{ 'margin-left': '12px' }}
            >
              {morph() === 'idle' ? '▶ RUN DEMO' : morph() === 'loading' ? `${Math.round(morphProgress())}%` : '✓ DONE'}
            </button>
          </div>
        </div>

        <div style={{
          position: 'relative',
          height: '500px',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
        }}>
          <div style={{
            position: 'relative',
            width: bboxWidth(),
            height: bboxHeight(),
            outline: `1px solid ${ACCENT}`,
            overflow: 'hidden',
            transition: `width ${MORPH_CSS} cubic-bezier(0.65, 0, 0.35, 1), height ${MORPH_CSS} cubic-bezier(0.65, 0, 0.35, 1)`,
          }}>
            <div style={{
              position: 'absolute', inset: '0',
              background: morph() === 'done'
                ? `linear-gradient(135deg, ${ACCENT} 0%, #7a0039 100%)`
                : 'linear-gradient(135deg, #2a2a2a 0%, #0a0a0a 100%)',
              opacity: isBar() ? '0' : '1',
              transform: isBar() ? 'scaleY(0.12)' : 'scale(1)',
              'transform-origin': 'center',
              transition: `opacity ${SLOW ? '1000ms' : '360ms'} ease, transform ${MORPH_CSS} cubic-bezier(0.65, 0, 0.35, 1), background ${MORPH_CSS} ease`,
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              color: '#fc006d',
              'font-size': '72px',
              'font-weight': '200',
              'letter-spacing': '0.3em',
              'text-transform': 'uppercase',
            }}>
              {morph() === 'done' ? '' : '▶'}
            </div>

            <div style={{
              position: 'absolute', inset: '0',
              opacity: isBar() ? '1' : '0',
              transition: `opacity ${SLOW ? '600ms' : '260ms'} ease ${isBar() ? (SLOW ? '900ms' : '320ms') : '0ms'}`,
              'pointer-events': isBar() ? 'auto' : 'none',
            }}>
              <Dynamic
                component={currentVariant().Bar}
                progress={morphProgress()}
                height={barHeightPx()}
              />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', 'justify-content': 'center', 'margin-top': '8px', 'font-size': '10px', opacity: '0.55', 'letter-spacing': '0.1em' }}>
          {morph() === 'idle' && 'READY'}
          {morph() === 'loading' && 'PROCESSING · video absorbed · bar running'}
          {morph() === 'done' && 'COMPLETE · morphing back to result bbox'}
        </div>
      </div>

      {/* ── FULL FLOW demo ───────────────────────────────────────────────── */}
      <div style={{ padding: '32px', 'border-bottom': `1px solid rgba(252,0,109,0.25)`, background: BG }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center', 'margin-bottom': '20px' }}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
            <Chip size="xs">FULL FLOW · VARIANT {currentFlowVariant().id}</Chip>
            <span style={{ 'font-size': '11px', opacity: '0.65' }}>import → upload → settings → process → result · real telemetry pipes into variant 03</span>
          </div>
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
            <For each={FLOW_VARIANTS}>{vi => (
              <div
                class="pg-variant-chip"
                classList={{ inactive: vi !== flowVariantIdx() }}
                onClick={() => { resetFlow(); setFlowVariantIdx(vi); }}
              >
                <Chip size="xs">{VARIANTS[vi].id}</Chip>
              </div>
            )}</For>
            <Show when={flowScene() === 'idle'} fallback={
              <button class="pg-btn pg-btn-ghost" onClick={resetFlow} style={{ 'margin-left': '12px' }}>⏹ stop</button>
            }>
              <button class="pg-btn" onClick={runFullFlow} style={{ 'margin-left': '12px' }}>▶ RUN FLOW</button>
            </Show>
          </div>
        </div>

        {/* Flow stage */}
        <div style={{
          position: 'relative',
          height: '600px',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          overflow: 'hidden',
        }}>
          {/* Scene label strip */}
          <div style={{
            position: 'absolute', top: '4px', left: '50%', transform: 'translateX(-50%)',
            display: 'flex', gap: '4px', 'z-index': '5',
          }}>
            <For each={[
              { key: 'import',     label: '01 · IMPORT' },
              { key: 'uploading',  label: '02 · UPLOAD' },
              { key: 'settings',   label: '03 · SETTINGS' },
              { key: 'processing', label: '04 · PROCESS' },
              { key: 'result',     label: '05 · RESULT' },
            ]}>{(s) => (
              <span style={{
                'font-size': '9px', 'letter-spacing': '0.08em', padding: '3px 7px',
                background: flowScene() === s.key ? ACCENT : 'transparent',
                color: flowScene() === s.key ? BG : ACCENT,
                border: `1px solid ${flowScene() === s.key ? ACCENT : 'rgba(252,0,109,0.3)'}`,
                animation: flowScene() === s.key ? 'pg-pulse 1.2s ease-in-out infinite' : 'none',
              }}>{s.label}</span>
            )}</For>
          </div>

          {/* Morphing bbox */}
          <div style={{
            position: 'relative',
            width: flowBboxWidth(),
            height: flowBboxHeight(),
            outline: flowIsBar() ? 'none' : `1px solid ${ACCENT}`,
            overflow: 'hidden',
            transition: `width 640ms cubic-bezier(0.65, 0, 0.35, 1), height 640ms cubic-bezier(0.65, 0, 0.35, 1), outline-color 200ms ease`,
          }}>
            {/* Import layer — facsimile of IdleView */}
            <div style={{
              position: 'absolute', inset: '0',
              display: 'flex', 'flex-direction': 'column', 'align-items': 'center', 'justify-content': 'center',
              opacity: flowIsImport() ? '1' : '0',
              transition: 'opacity 260ms ease',
              'pointer-events': 'none',
              'background-image': 'radial-gradient(circle, rgba(252,0,109,0.5) 1px, transparent 1px)',
              'background-size': '32px 32px',
              'background-position': '50% 50%',
            }}>
              {/* Inner corner crosshairs (visual rhyme with IdleView) */}
              <div style={{ position: 'absolute', top: '-10px', left: '-10px' }}><CornerCrosshair /></div>
              <div style={{ position: 'absolute', top: '-10px', right: '-10px' }}><CornerCrosshair /></div>
              <div style={{ position: 'absolute', bottom: '-10px', left: '-10px' }}><CornerCrosshair /></div>
              <div style={{ position: 'absolute', bottom: '-10px', right: '-10px' }}><CornerCrosshair /></div>
              <div style={{
                position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                width: '20px', height: '20px',
              }}>
                <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
                <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
              </div>
              <div style={{
                position: 'absolute', bottom: '48px', left: '0', right: '0',
                display: 'flex', 'flex-direction': 'column', 'align-items': 'center', gap: '2px',
              }}>
                <span style={{ 'font-family': MONO, 'font-size': '12px', 'line-height': '16px', color: ACCENT }}>DROP A FILE OR URL</span>
                <span style={{ 'font-family': "'IBM Plex Sans', system-ui, sans-serif", 'font-size': '12px', 'line-height': '16px', color: ACCENT, opacity: '0.8' }}>click to browse or ctrl+v anywhere</span>
              </div>
            </div>

            {/* Video bbox layer — settings + result */}
            <div style={{
              position: 'absolute', inset: '0',
              opacity: flowIsVideoBox() ? '1' : '0',
              transition: `opacity 260ms ease ${flowIsVideoBox() ? '320ms' : '0ms'}`,
              'pointer-events': 'none',
            }}>
              {/* Video surface */}
              <div style={{
                position: 'absolute', inset: '0',
                background: flowScene() === 'result'
                  ? `linear-gradient(135deg, ${ACCENT} 0%, #7a0039 100%)`
                  : 'linear-gradient(135deg, #2a2a2a 0%, #0a0a0a 100%)',
                transition: 'background 600ms ease',
                display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                color: flowScene() === 'result' ? BG : ACCENT,
                'font-family': MONO, 'font-size': '56px', 'font-weight': '200',
                'letter-spacing': '0.3em',
              }}>
                <Show when={flowScene() === 'settings'}>▶</Show>
                <Show when={flowScene() === 'result'}>✓</Show>
              </div>
              {/* Fake controls row — settings scene only */}
              <Show when={flowScene() === 'settings'}>
                <div style={{
                  position: 'absolute', left: '16px', right: '16px', bottom: '16px',
                  display: 'flex', 'justify-content': 'space-between', 'align-items': 'center',
                }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Chip size="xs">MP4</Chip>
                    <Chip size="xs">1920 × 1080</Chip>
                    <Chip size="xs">H.264</Chip>
                  </div>
                  <Chip size="xs">▶ PROCESS</Chip>
                </div>
              </Show>
              <Show when={flowScene() === 'result'}>
                <div style={{
                  position: 'absolute', top: '16px', right: '16px',
                }}>
                  <Chip size="xs">✓ DONE · 18.4 MB</Chip>
                </div>
              </Show>
            </div>

            {/* Bar layer — uploading + processing */}
            <div style={{
              position: 'absolute', inset: '0',
              opacity: flowIsBar() ? '1' : '0',
              transition: `opacity 260ms ease ${flowIsBar() ? '320ms' : '0ms'}`,
              'pointer-events': flowIsBar() ? 'auto' : 'none',
            }}>
              <Dynamic
                component={currentFlowVariant().Bar}
                progress={flowPct()}
                height={barHeightPx()}
                telemetry={flowTelemetry()}
              />
            </div>
          </div>

          {/* Footer — current telemetry summary */}
          <div style={{
            position: 'absolute', bottom: '8px', left: '50%', transform: 'translateX(-50%)',
            'font-size': '10px', opacity: '0.65', 'letter-spacing': '0.1em',
            'font-variant-numeric': 'tabular-nums',
            'white-space': 'nowrap',
          }}>
            <Show when={flowScene() === 'idle'}>READY · press RUN FLOW to walk the bbox through the whole loading journey</Show>
            <Show when={flowScene() === 'import'}>user drops file · transitioning into upload…</Show>
            <Show when={flowScene() === 'uploading' && flowTelemetry()}>
              {() => {
                const t = flowTelemetry()!;
                return <>UPLOADING · {formatBytes(t.bytesDone ?? 0)} / {formatBytes(t.bytesTotal ?? 0)} · {formatDuration(t.elapsedMs)}</>;
              }}
            </Show>
            <Show when={flowScene() === 'settings'}>settings panel · user picks output format…</Show>
            <Show when={flowScene() === 'processing' && flowTelemetry()}>
              {() => {
                const t = flowTelemetry()!;
                return <>PROCESSING · f {t.framesDone}/{t.framesTotal} · {(t.fps ?? 0).toFixed(0)}fps · {(t.speedX ?? 1).toFixed(2)}x · {formatDuration(t.elapsedMs)}</>;
              }}
            </Show>
            <Show when={flowScene() === 'result'}>COMPLETE · processed video ready</Show>
          </div>
        </div>
      </div>

      {/* ── Shortlist preview (variants 03 & 05, real telemetry) ─────────── */}
      <div style={{ padding: '40px 32px', display: 'flex', 'flex-direction': 'column', gap: '36px' }}>
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px' }}>
          <Chip size="xs">SHORTLIST · 03 & 05 · REAL TELEMETRY</Chip>
          <span style={{ 'font-size': '11px', opacity: '0.65' }}>
            auto-loop · first half simulates upload (bytes), second half simulates transcode (frames · fps · bitrate · eta)
          </span>
        </div>
        <For each={[VARIANTS[2], VARIANTS[4]]}>{v => {
          const V = v.Bar;
          return (
            <div>
              <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'baseline', 'margin-bottom': '10px' }}>
                <Chip size="xs">{v.label}</Chip>
                <span style={{ 'font-size': '10px', opacity: '0.55' }}>{v.tagline}</span>
              </div>
              <div style={{ width: `${barWidthVw()}vw`, 'margin': '0 auto' }}>
                <V progress={previewProgress()} height={barHeightPx()} telemetry={previewTelemetry()} />
              </div>
            </div>
          );
        }}</For>
      </div>

      <div style={{ padding: '20px 32px 40px', 'text-align': 'center', 'font-size': '10px', opacity: '0.5' }}>
        tell me which one(s) — i'll wire the winner into the real editor.
      </div>
    </div>
  );
};

export default BarPlayground;
