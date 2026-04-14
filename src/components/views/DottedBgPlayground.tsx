import { Component, createSignal, createEffect, onCleanup, For } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { drawSymbol, ALL_SYMBOLS, type SymbolType } from '../../shared/symbols';
import { CtrlSlider } from '../../shared/ui';

// ── hex → rgba helper ───────────────────────────────────────────────────────
function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Main component ──────────────────────────────────────────────────────────
const DottedBgPlayground: Component = () => {
  let canvasRef!: HTMLCanvasElement;

  // ── Controls ──────────────────────────────────────────────────────────────
  const [spacing, setSpacing]     = createSignal(32);
  const [symSize, setSymSize]     = createSignal(32);
  const [dotSize, setDotSize]     = createSignal(1);
  const [opacity, setOpacity]     = createSignal(50);
  const [color, setColor]         = createSignal('#fc006d');
  const [symbol, setSymbol]       = createSignal<SymbolType>('dot');

  // ── Preview box dimensions ────────────────────────────────────────────────
  const BOX_W = 560;
  const BOX_H = 400;

  // ── Draw ──────────────────────────────────────────────────────────────────
  function draw() {
    if (!canvasRef) return;
    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = Math.ceil(BOX_W * dpr);
    canvasRef.height = Math.ceil(BOX_H * dpr);
    const ctx = canvasRef.getContext('2d')!;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, BOX_W, BOX_H);

    const s = spacing();
    const ss = symSize();
    const sym = symbol();
    const col = hexToRgba(color(), opacity() / 100);
    const sw = dotSize();
    // Auto-center: derive offset so a symbol center lands at (BOX_W/2, BOX_H/2)
    const ox = ((BOX_W / 2 - s / 2) % s + s) % s;
    const oy = ((BOX_H / 2 - s / 2) % s + s) % s;
    const pad = (s - ss) / 2;

    const cols = Math.ceil(BOX_W / s) + 1;
    const rows = Math.ceil(BOX_H / s) + 1;

    for (let r = -1; r < rows; r++) {
      for (let c = -1; c < cols; c++) {
        drawSymbol(ctx, sym, c * s + ox + pad, r * s + oy + pad, ss, sw, col);
      }
    }
  }

  createEffect(() => {
    spacing(); symSize(); dotSize(); opacity(); color(); symbol();
    draw();
  });

  // ── Copy values ───────────────────────────────────────────────────────────
  const [copyState, setCopyState] = createSignal<'idle' | 'ok' | 'err'>('idle');

  const cssOutput = () => {
    const s = spacing();
    const col = hexToRgba(color(), opacity() / 100);
    if (symbol() === 'dot') {
      return `'background-image': 'radial-gradient(circle, ${col} ${dotSize()}px, transparent ${dotSize()}px)',\n'background-size': '${s}px ${s}px',\n'background-position': '50% 50%',  // auto-centered`;
    }
    return `// canvas-based — use drawSymbol()\n// background-position: 50% 50% auto-centers the tile\n{\n  spacing: ${s},\n  symbolSize: ${symSize()},\n  strokeW: ${dotSize()},\n  symbol: '${symbol()}',\n  color: '${col}',\n}`;
  };

  const copyValues = async () => {
    try {
      await navigator.clipboard.writeText(cssOutput());
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
      {/* ── Left: Preview ── */}
      <div style={{ 'flex-shrink': '0' }}>
        <div style={{ 'font-family': MONO, 'font-size': '10px', color: '#333', 'margin-bottom': '8px', 'letter-spacing': '0.08em' }}>
          PREVIEW {BOX_W}&times;{BOX_H}
        </div>
        <div style={{
          position: 'relative',
          width: `${BOX_W}px`, height: `${BOX_H}px`,
          overflow: 'hidden', outline: `1px solid ${ACCENT}`,
          background: BG,
        }}>
          <canvas
            ref={canvasRef!}
            style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' }}
          />
          {/* Center crosshair overlay */}
          <div style={{ position: 'absolute', top: 'calc(50% - 10px)', left: 'calc(50% - 10px)', width: '20px', height: '20px', 'pointer-events': 'none' }}>
            <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
            <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
          </div>
        </div>
      </div>

      {/* ── Right: Controls ── */}
      <div style={{
        display: 'flex', 'flex-direction': 'column', gap: '16px', 'font-family': MONO,
        'align-self': 'flex-start', 'padding-top': '40px', 'flex-shrink': '0',
        'overflow-y': 'auto', 'max-height': '100%',
      }}>
        {/* SPACING */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>SPACING</div>
          <CtrlSlider label="grid size" value={spacing()} min={8} max={100} onChange={setSpacing} suffix="px" accent={color()} />
          <CtrlSlider label="sym size" value={symSize()} min={4} max={64} onChange={setSymSize} suffix="px" accent={color()} />
          <div style={{ 'font-size': '10px', color: '#333', 'line-height': '16px' }}>
            {Math.ceil(BOX_W / spacing())}&times;{Math.ceil(BOX_H / spacing())} cells
          </div>
        </div>

        {/* SYMBOL */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>SYMBOL</div>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', 'max-width': '220px' }}>
            <For each={ALL_SYMBOLS}>
              {(sym) => (
                <button onClick={() => setSymbol(sym.id)} style={btn(symbol() === sym.id)}>
                  {sym.label}
                </button>
              )}
            </For>
          </div>
          <CtrlSlider label="stroke" value={dotSize()} min={0.5} max={4} step={0.5} onChange={setDotSize} suffix="px" accent={color()} />
        </div>

        {/* COLOR */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>COLOR</div>
          <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
            <input type="color" value={color()} onInput={e => setColor(e.currentTarget.value)}
              style={{ width: '32px', height: '24px', border: '1px solid #ccc', cursor: 'pointer', padding: '0' }} />
            <span style={{ 'font-size': '11px', color: '#555' }}>{color()}</span>
          </div>
          <CtrlSlider label="opacity" value={opacity()} min={5} max={100} step={5} onChange={setOpacity} suffix="%" accent={color()} />
        </div>

        {/* OUTPUT */}
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
          <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-bottom': '2px' }}>OUTPUT</div>
          <pre style={{
            'font-size': '9px', color: '#555', 'line-height': '14px',
            margin: '0', 'white-space': 'pre-wrap', 'max-width': '240px',
            background: '#f0efee', padding: '8px', border: '1px solid #e0dfde',
          }}>{cssOutput()}</pre>
          <button onClick={copyValues} style={{
            ...btn(copyState() === 'ok'),
            color: copyState() === 'ok' ? '#fff' : copyState() === 'err' ? '#c00' : '#555',
            'align-self': 'flex-start',
          }}>
            {copyState() === 'ok' ? 'copied' : copyState() === 'err' ? 'error' : 'copy values'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DottedBgPlayground;
