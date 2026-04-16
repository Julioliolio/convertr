import { Component, createSignal, createEffect, onCleanup, onMount, For } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { drawSymbol, ALL_SYMBOLS, farthestPointSample, type SymbolType, type CellInfo } from '../../shared/symbols';
import { CtrlSlider } from '../../shared/ui';

// ── Synthetic test video ─────────────────────────────────────────────────────
function createTestVideo(): Promise<string> {
  return new Promise(resolve => {
    const W = 640, H = 360, FPS = 30, SECS = 4;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const stream = canvas.captureStream(FPS);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];
    recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
    recorder.onstop = () => resolve(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })));
    recorder.start();
    const BARS = ['#c00', '#cc0', '#0c0', '#0cc', '#00c', '#c0c', '#ccc'];
    let frame = 0;
    const total = FPS * SECS;
    const draw = () => {
      const barW = W / BARS.length;
      for (let i = 0; i < BARS.length; i++) { ctx.fillStyle = BARS[i]; ctx.fillRect(i * barW, 0, barW, H); }
      const x = (frame / total) * W;
      ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, 0, 4, H);
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 120, 36);
      ctx.fillStyle = '#fff'; ctx.font = '20px monospace'; ctx.fillText(`f ${frame}/${total}`, 8, 26);
      frame++;
      if (frame <= total) requestAnimationFrame(draw); else recorder.stop();
    };
    draw();
  });
}

// ── Constants ────────────────────────────────────────────────────────────────
const ORIENTATIONS = {
  landscape: { boxW: 560, boxH: Math.round(560 * 9 / 16) },
  portrait:  { boxW: 315, boxH: 560 },
} as const;

// ── Main component ──────────────────────────────────────────────────────────
const LoadingPlayground: Component = () => {
  let videoRef!: HTMLVideoElement;
  let canvasRef!: HTMLCanvasElement;

  // ── Video ─────────────────────────────────────────────────────────────────
  const [orientation, setOrientation] = createSignal<'landscape' | 'portrait'>('landscape');
  const [videoSrc, setVideoSrc]       = createSignal<string | null>(null);
  const [playing, setPlaying]         = createSignal(false);
  const box = () => ORIENTATIONS[orientation()];

  onMount(async () => { setVideoSrc(await createTestVideo()); });

  // ── Controls ──────────────────────────────────────────────────────────────
  const [cellSize, setCellSize]           = createSignal(24);
  const [strokeW, setStrokeW]             = createSignal(1);
  const [color, setColor]                 = createSignal('#fc006d');
  const [lingerCount, setLingerCount]     = createSignal(2);
  const [lingerDuration, setLingerDuration] = createSignal(0.5);
  const [flickerSpeed, setFlickerSpeed]   = createSignal(75);
  const [symbol, setSymbol]               = createSignal<SymbolType>('square');

  // ── Derived ───────────────────────────────────────────────────────────────
  const gridCols = () => Math.ceil(box().boxW / cellSize());
  const gridRows = () => Math.ceil(box().boxH / cellSize());

  // ── Animation state (plain JS) ────────────────────────────────────────────
  let lingerCells: CellInfo[] = [];
  let startTime = 0;
  let rafId = 0;

  function initAndDraw() {
    if (!canvasRef) return;
    const dpr = window.devicePixelRatio || 1;
    const w = box().boxW, h = box().boxH;
    canvasRef.width = Math.ceil(w * dpr);
    canvasRef.height = Math.ceil(h * dpr);
    const ctx = canvasRef.getContext('2d')!;
    ctx.scale(dpr, dpr);

    lingerCells = farthestPointSample(gridRows(), gridCols(), lingerCount());
    startTime = performance.now();
    setPlaying(true);
  }

  function drawFrame(now: number) {
    const ctx = canvasRef?.getContext('2d');
    if (!ctx) return;
    const w = box().boxW, h = box().boxH;
    const s = cellSize();

    ctx.clearRect(0, 0, w, h);

    const elapsed = now - startTime;
    if (elapsed >= lingerDuration() * 1000) {
      setPlaying(false);
      return;
    }

    const flickerOn = Math.floor(elapsed / flickerSpeed()) % 2 === 0;
    if (flickerOn) {
      const sym = symbol();
      for (const cell of lingerCells) {
        drawSymbol(ctx, sym, cell.col * s, cell.row * s, s, strokeW(), color());
      }
    }
  }

  function loop(now: number) {
    if (!playing()) return;
    drawFrame(now);
    if (playing()) rafId = requestAnimationFrame(loop);
  }

  function replay() {
    if (rafId) cancelAnimationFrame(rafId);
    initAndDraw();
    rafId = requestAnimationFrame(loop);
  }

  // Re-init when grid dimensions change
  createEffect(() => {
    gridRows(); gridCols(); lingerCount(); // subscribe
    replay();
  });

  onCleanup(() => { if (rafId) cancelAnimationFrame(rafId); });

  // ── Copy values ────────────────────────────────────────────────────────────
  const [copyState, setCopyState] = createSignal<'idle' | 'ok' | 'err'>('idle');
  const copyValues = async () => {
    const text = `{\n` +
      `  cellSize: ${cellSize()},\n` +
      `  strokeW: ${strokeW()},\n` +
      `  symbol: '${symbol()}',\n` +
      `  color: '${color()}',\n` +
      `  lingerCount: ${lingerCount()},\n` +
      `  lingerDuration: ${lingerDuration()},\n` +
      `  flickerSpeed: ${flickerSpeed()},\n` +
      `}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('ok');
    } catch { setCopyState('err'); }
    setTimeout(() => setCopyState('idle'), 2500);
  };

  // ── Button style ──────────────────────────────────────────────────────────
  const btn = (hl: boolean) => ({
    background: hl ? color() : 'transparent',
    border: `1px solid ${hl ? color() : '#2a2a2a'}`,
    color: hl ? '#fff' : '#555', cursor: 'pointer', padding: '4px 12px',
    'font-family': MONO, 'font-size': '11px',
    transition: 'background 0.15s, color 0.15s, border-color 0.15s',
  });

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div style={{
      position: 'fixed', inset: '0', background: BG,
      display: 'flex', 'align-items': 'center', 'justify-content': 'center',
      gap: '40px', padding: '40px', 'box-sizing': 'border-box',
    }}>
      {/* ── Left: Bounding box ── */}
      <div style={{ 'flex-shrink': '0' }}>
        <div style={{ 'margin-bottom': '12px' }}>
          <button
            onClick={() => setOrientation(o => o === 'landscape' ? 'portrait' : 'landscape')}
            style={{
              background: ACCENT, color: BG, border: 'none',
              'font-family': MONO, 'font-size': '11px', 'line-height': '1',
              padding: '6px 10px', cursor: 'pointer',
            }}
          >
            {orientation() === 'landscape' ? '&#8597; portrait' : '&#8596; landscape'}
          </button>
        </div>

        <div style={{
          position: 'relative',
          width: `${box().boxW}px`, height: `${box().boxH}px`,
          overflow: 'hidden', outline: `1px solid ${ACCENT}`,
        }}>
          <video ref={videoRef!} src={videoSrc() ?? ''} autoplay loop muted playsinline
            style={{ width: '100%', height: '100%', display: 'block', 'object-fit': 'cover' }}
          />
          <canvas
            ref={canvasRef!}
            style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }}
          />
        </div>
      </div>

      {/* ── Right: Control panel ── */}
      <div style={{
        display: 'flex', 'flex-direction': 'column', gap: '16px', 'font-family': MONO,
        'align-self': 'flex-start', 'padding-top': '40px', 'flex-shrink': '0',
        'overflow-y': 'auto', 'max-height': '100%',
      }}>
        {/* STATE */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>STATE</div>
          <div style={{ 'font-size': '11px', color: ACCENT, 'font-weight': '500' }}>{playing() ? 'lingering' : 'done'}</div>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button onClick={replay} style={btn(false)}>replay</button>
            <button onClick={copyValues} style={{
              ...btn(copyState() === 'ok'),
              color: copyState() === 'ok' ? '#fff' : copyState() === 'err' ? '#c00' : '#555',
            }}>{copyState() === 'ok' ? 'copied' : copyState() === 'err' ? 'error' : 'copy values'}</button>
          </div>
        </div>

        {/* GRID */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>GRID</div>
          <CtrlSlider label="cell size" value={cellSize()} min={8} max={48} onChange={setCellSize} suffix="px" accent={color()} />
          <CtrlSlider label="stroke" value={strokeW()} min={0.5} max={3} step={0.5} onChange={setStrokeW} suffix="px" accent={color()} />
          <div style={{ 'font-size': '10px', color: '#333', 'line-height': '16px' }}>
            {gridCols()}&times;{gridRows()} cells
          </div>
        </div>

        {/* SYMBOL */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>SYMBOL</div>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', 'max-width': '220px' }}>
            <For each={ALL_SYMBOLS}>
              {(sym) => (
                <button
                  onClick={() => { setSymbol(sym.id); replay(); }}
                  style={btn(symbol() === sym.id)}
                >{sym.label}</button>
              )}
            </For>
          </div>
        </div>

        {/* COLOR */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>COLOR</div>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
            <input type="color" value={color()} onInput={e => setColor(e.currentTarget.value)}
              style={{ width: '32px', height: '24px', border: '1px solid #ccc', cursor: 'pointer', padding: '0' }} />
            <span style={{ 'font-size': '11px', color: '#555' }}>{color()}</span>
          </div>
        </div>

        {/* LINGER */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>LINGER</div>
          <CtrlSlider label="count" value={lingerCount()} min={1} max={50} onChange={setLingerCount} accent={color()} />
          <CtrlSlider label="duration" value={lingerDuration()} min={0.5} max={5} step={0.5} onChange={setLingerDuration} suffix="s" accent={color()} />
          <CtrlSlider label="flicker" value={flickerSpeed()} min={50} max={500} step={25} onChange={setFlickerSpeed} suffix="ms" accent={color()} />
        </div>
      </div>
    </div>
  );
};

export default LoadingPlayground;
