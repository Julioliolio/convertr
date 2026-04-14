import { Component, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { appState, setAppState } from '../../state/app';
import { ACCENT, ACCENT_75, BG, MONO } from '../../shared/tokens';
import { FormatButton } from '../../shared/ui';
import { scrambleText } from '../../shared/utils';

const DITHER_SCRAMBLE_CHARS = 'abcdefghijklmnopqrstuvwxyz0123456789';

const DITHER_OPTIONS = [
  { value: 'sierra2_4a', label: 'sierra42a', title: 'best balance', desc: 'smooth gradients with small file size. good default for most videos.' },
  { value: 'floyd_steinberg', label: 'floid steinberg', title: 'best quality', desc: 'preserves the most detail but produces slightly larger files.' },
  { value: 'bayer', label: 'bayer', title: 'fastest processing', desc: 'gives a stylized retro grid look. great for pixel art or looping gifs.' },
  { value: 'none', label: 'none', title: 'smallest file', desc: 'no smoothing, so you get hard color bands. best when file size matters most.' },
] as const;

// ── Dithering algorithms ─────────────────────────────────────────────────────
let _ditherBuf: Float32Array | null = null;

const applyDither = (data: ImageData, method: string, levels = 4) => {
  const { width, height, data: px } = data;
  const step = 255 / (levels - 1);
  const q = (v: number) => Math.min(255, Math.max(0, Math.round(Math.round(v / step) * step)));

  if (method === 'none') {
    for (let i = 0; i < px.length; i += 4) {
      px[i] = q(px[i]); px[i + 1] = q(px[i + 1]); px[i + 2] = q(px[i + 2]);
    }
    return;
  }

  if (method === 'bayer') {
    const m = [
      [0, 8, 2, 10], [12, 4, 14, 6],
      [3, 11, 1, 9], [15, 7, 13, 5],
    ];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const t = (m[y % 4][x % 4] / 16 - 0.5) * step;
        px[i] = q(px[i] + t); px[i + 1] = q(px[i + 1] + t); px[i + 2] = q(px[i + 2] + t);
      }
    }
    return;
  }

  // Error diffusion (floyd_steinberg / sierra2_4a) — reuse buffer across calls
  const needed = width * height * 3;
  if (!_ditherBuf || _ditherBuf.length < needed) _ditherBuf = new Float32Array(needed);
  const buf = _ditherBuf;
  for (let i = 0; i < px.length; i += 4) {
    const j = (i >> 2) * 3;
    buf[j] = px[i]; buf[j + 1] = px[i + 1]; buf[j + 2] = px[i + 2];
  }

  const spread = (x: number, y: number, er: number, eg: number, eb: number, w: number) => {
    if (x < 0 || x >= width || y >= height) return;
    const j = (y * width + x) * 3;
    buf[j] += er * w; buf[j + 1] += eg * w; buf[j + 2] += eb * w;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const j = (y * width + x) * 3;
      const i = (y * width + x) * 4;
      const or = Math.min(255, Math.max(0, buf[j]));
      const og = Math.min(255, Math.max(0, buf[j + 1]));
      const ob = Math.min(255, Math.max(0, buf[j + 2]));
      const nr = q(or), ng = q(og), nb = q(ob);
      px[i] = nr; px[i + 1] = ng; px[i + 2] = nb;
      const er = or - nr, eg = og - ng, eb = ob - nb;

      if (method === 'floyd_steinberg') {
        spread(x + 1, y, er, eg, eb, 7 / 16);
        spread(x - 1, y + 1, er, eg, eb, 3 / 16);
        spread(x, y + 1, er, eg, eb, 5 / 16);
        spread(x + 1, y + 1, er, eg, eb, 1 / 16);
      } else { // sierra2_4a
        spread(x + 1, y, er, eg, eb, 2 / 4);
        spread(x - 1, y + 1, er, eg, eb, 1 / 4);
        spread(x, y + 1, er, eg, eb, 1 / 4);
      }
    }
  }
};

// ── Main component ───────────────────────────────────────────────────────────
const PREVIEW_W = 200; // world-space width of video at zoom=1

const SettingsCanvas: Component<{
  videoEl?: HTMLVideoElement;
}> = (props) => {
  const [ditherOpen, setDitherOpen] = createSignal(false);
  type Tip = { title: string; desc: string } | null;
  const [tooltipRaw, setTooltip] = createSignal<Tip>(null);
  const [tooltipVisible, setTooltipVisible] = createSignal(false);
  const [displayTitle, setDisplayTitle] = createSignal('');
  const [displayDesc, setDisplayDesc] = createSignal('');
  let tipScrambleRaf = 0;
  let tipHideTimer = 0;

  const scrambleTooltip = (tip: { title: string; desc: string }) => {
    tipScrambleRaf = scrambleText([
      { target: tip.title, setter: setDisplayTitle },
      { target: tip.desc, setter: setDisplayDesc },
    ], tipScrambleRaf, { frames: 10, frameMs: 20, chars: DITHER_SCRAMBLE_CHARS });
  };

  createEffect(() => {
    const raw = tooltipRaw();
    clearTimeout(tipHideTimer);
    if (raw) {
      setTooltipVisible(true);
      scrambleTooltip(raw);
    } else {
      tipHideTimer = window.setTimeout(() => setTooltipVisible(false), 150);
    }
  });
  onCleanup(() => {
    cancelAnimationFrame(tipScrambleRaf);
    clearTimeout(tipHideTimer);
  });

  // Show tooltip when dropdown opens, hide when it closes
  createEffect(() => {
    if (ditherOpen()) {
      setTooltip({ title: currentDither().title, desc: currentDither().desc });
    } else {
      setTooltip(null);
    }
  });

  let containerRef!: HTMLDivElement;

  const currentDither = () =>
    DITHER_OPTIONS.find(o => o.value === appState.dither) ?? DITHER_OPTIONS[0];

  // ── Pan & Zoom ─────────────────────────────────────────────────────────────
  const [panPos, setPan] = createSignal({ x: 0, y: 0 });
  const [zoom, setZoom] = createSignal(1);
  const [dragging, setDragging] = createSignal(false);
  const [animate, setAnimate] = createSignal(false);
  let dragStart = { x: 0, y: 0, px: 0, py: 0 };
  let didDrag = false;

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();

    if (e.ctrlKey || e.metaKey) {
      // ── Zoom: pinch gesture or Ctrl/Cmd+scroll ──
      const rect = containerRef.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      const cx = rect.width / 2;
      const cy = rect.height / 2;

      // clamp delta — pinch sends tiny values, mouse wheel sends large ones
      const d = Math.max(-10, Math.min(10, e.deltaY));
      const oldZ = zoom();
      const newZ = Math.min(Math.max(oldZ * Math.pow(2, -d * 0.01), 0.1), 20);

      // zoom toward cursor
      const worldX = (cursorX - cx - panPos().x) / oldZ;
      const worldY = (cursorY - cy - panPos().y) / oldZ;
      setPan({ x: cursorX - cx - worldX * newZ, y: cursorY - cy - worldY * newZ });
      setZoom(newZ);
    } else {
      // ── Pan: two-finger scroll or regular scroll wheel ──
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
    }
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return; // left or middle click
    didDrag = false;
    setDragging(true);
    dragStart = { x: e.clientX, y: e.clientY, px: panPos().x, py: panPos().y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDrag = true;
    setPan({ x: dragStart.px + dx, y: dragStart.py + dy });
  };

  const handlePointerUp = () => {
    setDragging(false);
    if (!didDrag) setDitherOpen(false);
  };

  const [displayDither, setDisplayDither] = createSignal(currentDither().label);
  let scrambleRaf = 0;
  const scrambleTo = (target: string) => {
    scrambleRaf = scrambleText(
      [{ target, setter: setDisplayDither }],
      scrambleRaf,
      { frames: 8, frameMs: 25, chars: DITHER_SCRAMBLE_CHARS },
    );
  };
  onCleanup(() => cancelAnimationFrame(scrambleRaf));

  const selectDither = (value: string) => {
    const opt = DITHER_OPTIONS.find(o => o.value === value);
    if (opt) scrambleTo(opt.label);
    setAppState('dither', value);
    setDitherOpen(false);
  };

  // ── Video preview (world-space sized, drawn once) ──────────────────────────
  const [previewH, setPreviewH] = createSignal(PREVIEW_W * 0.5625); // default 16:9
  let canvasEl!: HTMLCanvasElement;

  const drawPreview = () => {
    const v = props.videoEl;
    if (!v || !v.videoWidth) return;
    canvasEl.width = v.videoWidth;
    canvasEl.height = v.videoHeight;
    const ctx = canvasEl.getContext('2d')!;
    ctx.drawImage(v, 0, 0, v.videoWidth, v.videoHeight);
    const img = ctx.getImageData(0, 0, v.videoWidth, v.videoHeight);
    applyDither(img, appState.dither);
    ctx.putImageData(img, 0, 0);
    setPreviewH(PREVIEW_W / (v.videoWidth / v.videoHeight));
  };

  // Redraw when video loads or dither algorithm changes
  createEffect(() => {
    const v = props.videoEl;
    void appState.dither;
    if (!v) return;
    drawPreview();
    v.addEventListener('seeked', drawPreview);
    v.addEventListener('loadeddata', drawPreview);
    onCleanup(() => {
      v.removeEventListener('seeked', drawPreview);
      v.removeEventListener('loadeddata', drawPreview);
    });
  });

  return (
    <div
      ref={containerRef!}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        'aspect-ratio': '597 / 433',
        background: BG,
        border: `1px solid ${ACCENT}`,
        overflow: 'clip',
        'box-sizing': 'border-box',
        'margin-bottom': '12px',
        'flex-shrink': '0',
      }}
    >
      {/* ── Pannable / zoomable canvas layer ── */}
      <div
        style={{
          position: 'absolute',
          inset: '0',
          cursor: dragging() ? 'grabbing' : 'grab',
          'touch-action': 'none',
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Transform group — centered, then offset by pan/zoom */}
        <div style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: `translate(${panPos().x}px, ${panPos().y}px) scale(${zoom()})`,
          'transform-origin': '0 0',
          transition: animate() ? 'transform 250ms ease-in-out' : 'none',
        }}>
          {/* Dotted background — moves with canvas like Figma */}
          <div style={{
            position: 'absolute',
            left: '-5000px',
            top: '-5000px',
            width: '10000px',
            height: '10000px',
            'background-color': BG,
            'background-image': `radial-gradient(circle, ${ACCENT} 1px, transparent 1px)`,
            'background-size': '32px 32px',
          }} />
          <canvas
            ref={canvasEl!}
            style={{
              position: 'relative',
              display: 'block',
              width: `${PREVIEW_W}px`,
              height: `${previewH()}px`,
              translate: '-50% -50%',
              border: `1px solid ${ACCENT_75}`,
            }}
          />
        </div>
      </div>

      {/* ── UI Overlay (fixed, doesn't pan/zoom) ── */}
      <div style={{
        position: 'absolute',
        inset: '0',
        'pointer-events': 'none',
        'z-index': '3',
      }}>
        {/* Dithering dropdown */}
        {(() => {
          const ITEM_H = 20;
          const ITEM_GAP = 4;
          const ITEMS_PAD_TOP = 4;
          const BTN_H = 20;
          const nItems = () => DITHER_OPTIONS.filter(o => o.value !== appState.dither).length;
          const closedH = () => BTN_H;
          const openH = () => BTN_H + ITEMS_PAD_TOP + nItems() * ITEM_H + (nItems() - 1) * ITEM_GAP;

          return (
            <div style={{
              position: 'absolute',
              right: '16px', top: '14px',
              display: 'flex', 'flex-direction': 'column',
              'align-items': 'flex-end',
              overflow: 'hidden',
              height: `${ditherOpen() ? openH() : closedH()}px`,
              transition: 'height 200ms cubic-bezier(0.006, 0.984, 0.000, 1.109)',
              'pointer-events': 'auto',
            }}>
              <div onMouseEnter={() => ditherOpen() && setTooltip({ title: currentDither().title, desc: currentDither().desc })}>
                <FormatButton
                  format={displayDither()}
                  open={ditherOpen()}
                  onClick={() => setDitherOpen(o => !o)}
                  spring={{ dur: 0.200, x1: 0.006, y1: 0.984, x2: 0.000, y2: 1.109 }}
                />
              </div>
              <div style={{
                display: 'flex', 'flex-direction': 'column',
                'align-items': 'flex-end',
                'padding-top': `${ITEMS_PAD_TOP}px`,
                gap: `${ITEM_GAP}px`,
                'pointer-events': ditherOpen() ? 'auto' : 'none',
              }}>
                <For each={DITHER_OPTIONS.filter(o => o.value !== appState.dither)}>
                  {(opt) => (
                    <div
                      style={{
                        'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
                        color: ACCENT, cursor: 'pointer', 'user-select': 'none',
                      }}
                      onMouseEnter={() => setTooltip({ title: opt.title, desc: opt.desc })}
                      onClick={() => { selectDither(opt.value); setTooltip(null); }}
                    >
                      {opt.label}
                    </div>
                  )}
                </For>
              </div>
            </div>
          );
        })()}

        {/* Tooltip box — positioned at top-left */}
        <Show when={tooltipVisible()}>
          <div style={{
            position: 'absolute',
            left: '16px', top: '14px',
            width: '320px',
            border: `1px solid ${ACCENT}`,
            background: BG,
            padding: '8px 10px',
            'font-family': MONO,
            'font-size': '11px',
            'line-height': '15px',
            color: ACCENT,
            'pointer-events': 'none',
            'box-sizing': 'border-box',
            opacity: tooltipRaw() ? '1' : '0',
            transform: tooltipRaw() ? 'translate(0, 0)' : 'translate(0, -4px)',
            transition: 'opacity 150ms ease, transform 150ms ease',
          }}>
            <div style={{ 'font-weight': '700', 'font-size': '12px', 'margin-bottom': '4px' }}>{displayTitle()}</div>
            <div>{displayDesc()}</div>
          </div>
        </Show>

        {/* Zoom controls — bottom right */}
        <div style={{
          position: 'absolute',
          right: '10px', bottom: '10px',
          display: 'flex', gap: '4px',
          'pointer-events': 'auto',
        }}>
            {[
              { label: '+', action: () => {
                const oldZ = zoom();
                const newZ = Math.min(oldZ * 1.3, 20);
                setPan(p => ({ x: p.x * newZ / oldZ, y: p.y * newZ / oldZ }));
                setZoom(newZ);
              }},
              { label: '−', action: () => {
                const oldZ = zoom();
                const newZ = Math.max(oldZ / 1.3, 0.1);
                setPan(p => ({ x: p.x * newZ / oldZ, y: p.y * newZ / oldZ }));
                setZoom(newZ);
              }},
              { label: '⊙', action: () => { setPan({ x: 0, y: 0 }); setZoom(1); }},
            ].map(btn => (
              <div
                style={{
                  width: '25px', height: '25px',
                  display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                  border: `1px solid ${ACCENT_75}`,
                  background: BG,
                  color: ACCENT,
                  'font-family': MONO,
                  'font-size': '14px',
                  'line-height': '1',
                  cursor: 'pointer',
                  'user-select': 'none',
                  'box-sizing': 'border-box',
                }}
                onClick={() => { setAnimate(true); btn.action(); setTimeout(() => setAnimate(false), 260); }}
              >
                {btn.label}
              </div>
            ))}
        </div>
      </div>

    </div>
  );
};

export default SettingsCanvas;
