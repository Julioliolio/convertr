import { Component, createSignal, createEffect, For, Show, onCleanup, onMount } from 'solid-js';
import { appState, setAppState } from '../../state/app';
import { ACCENT, ACCENT_75, BG, MONO } from '../../shared/tokens';
import { FormatButton, Chip } from '../../shared/ui';
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
  isPortrait?: boolean;
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

  // Close the dither dropdown whenever the output format leaves GIF so the
  // menu isn't stranded open behind the (now hidden) trigger button.
  createEffect(() => {
    if (appState.outputFormat !== 'gif' && ditherOpen()) setDitherOpen(false);
  });

  let containerRef!: HTMLDivElement;

  const currentDither = () =>
    DITHER_OPTIONS.find(o => o.value === appState.dither) ?? DITHER_OPTIONS[0];

  // ── Pan & Zoom ─────────────────────────────────────────────────────────────
  const [panPos, setPan] = createSignal({ x: 0, y: 0 });
  const [zoom, setZoom] = createSignal(1);
  const [dragging, setDragging] = createSignal(false);
  const [animate, setAnimate] = createSignal(false);
  const [containerSize, setContainerSize] = createSignal({ w: 0, h: 0 });
  let dragStart = { x: 0, y: 0, px: 0, py: 0 };
  let didDrag = false;

  // "Contain" fit: scale so the whole preview fits inside the container with
  // a small margin on all sides. Picks the smaller dimension-scale so neither
  // axis overflows — the opposing axis gets letterboxed/pillarboxed by the
  // dotted background. Leaves visible breathing room around the preview so
  // the user can see the full frame at once.
  const fitToContainer = () => {
    const { w: cw, h: ch } = containerSize();
    const pw = previewW(), ph = previewH();
    if (!cw || !ch || !pw || !ph) return;
    const pad = 32;
    const widthScale  = (cw - pad) / pw;
    const heightScale = (ch - pad) / ph;
    const scale = Math.min(widthScale, heightScale) * 0.6;
    setPan({ x: 0, y: 0 });
    setZoom(Math.max(0.1, Math.min(scale, 20)));
  };

  onMount(() => {
    const ro = new ResizeObserver(() => {
      setContainerSize({ w: containerRef.clientWidth, h: containerRef.clientHeight });
    });
    ro.observe(containerRef);
    onCleanup(() => ro.disconnect());
  });

  // Auto-fit whenever the preview dimensions OR the container dimensions
  // change — but only until the user has manually pan/zoomed. This matters
  // for the common flow where the video loads while the settings panel is
  // still hidden (container 0×0) and only later animates to its full size:
  // a preview-dim-only trigger would fire too early (container still 0)
  // and never refit once the panel finally grew. Once the user interacts
  // with pan/zoom, we stop auto-fitting so we don't stomp on their view.
  // The ⊙ refit button re-arms this auto-fit.
  let userAdjusted = false;
  createEffect(() => {
    const pw = previewW();
    const ph = previewH();
    const { w: cw, h: ch } = containerSize();
    if (pw <= 0 || ph <= 0 || cw <= 0 || ch <= 0) return;
    if (!userAdjusted) fitToContainer();
  });

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    userAdjusted = true;

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
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) { didDrag = true; userAdjusted = true; }
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

  // ── Video preview — rendered AND displayed at the real output resolution ───
  // so 1 canvas pixel = 1 screen pixel at zoom=1. Use the pan/zoom controls
  // to fit the whole image in the panel or zoom in further.
  const [previewW, setPreviewW] = createSignal(PREVIEW_W);
  const [previewH, setPreviewH] = createSignal(PREVIEW_W * 0.5625); // default 16:9
  let canvasEl!: HTMLCanvasElement;

  // The preview is rendered at the TARGET output resolution so the user sees
  // how the final conversion will actually look (including real-resolution
  // dither artifacts). Capped to avoid pathological memory use on huge sources.
  const PROCESS_MAX_W = 1920;

  // Compute target output dimensions from appState (mirrors analyticalSize in EditorView).
  const targetDims = () => {
    const v = props.videoEl;
    if (!v || !v.videoWidth) return null;
    const srcW = v.videoWidth, srcH = v.videoHeight;
    const isGif = appState.outputFormat === 'gif';
    const setW  = isGif ? appState.width : appState.vidWidth;
    const rawW  = setW > 0 ? setW : srcW;
    const w = Math.max(1, Math.min(PROCESS_MAX_W, rawW));
    const h = Math.max(1, Math.round(w * srcH / srcW));
    return { w, h, srcW, srcH };
  };

  // Non-GIF preview: draw the live video frame at target output dimensions
  // without the dither step. Paired with an rAF loop below that samples the
  // upstream <video> at the target fps so the user sees playback at the
  // resolution AND frame rate they'll get.
  const drawVideoFrame = () => {
    const v = props.videoEl;
    if (!v || !v.videoWidth || v.readyState < 2) return;
    const d = targetDims();
    if (!d) return;
    if (canvasEl.width  !== d.w) canvasEl.width  = d.w;
    if (canvasEl.height !== d.h) canvasEl.height = d.h;
    const ctx = canvasEl.getContext('2d')!;
    ctx.drawImage(v, 0, 0, d.w, d.h);
    setPreviewW(d.w);
    setPreviewH(d.h);
  };

  const drawPreview = () => {
    const v = props.videoEl;
    if (!v || !v.videoWidth || v.readyState < 2) return;
    const d = targetDims();
    if (!d) return;
    if (canvasEl.width  !== d.w) canvasEl.width  = d.w;
    if (canvasEl.height !== d.h) canvasEl.height = d.h;
    const ctx = canvasEl.getContext('2d')!;
    ctx.drawImage(v, 0, 0, d.w, d.h);
    // Dither only runs for GIF output — other formats render the raw video
    // frame at target resolution so users see the actual "scaled" preview.
    if (appState.outputFormat === 'gif') {
      const img = ctx.getImageData(0, 0, d.w, d.h);
      applyDither(img, appState.dither);
      ctx.putImageData(img, 0, 0);
    }
    // Display canvas at 1:1 with its internal resolution so the user sees
    // true output pixels.
    setPreviewW(d.w);
    setPreviewH(d.h);
  };

  // Debounce the dither redraw so slider drags don't block the main thread.
  // Full Floyd-Steinberg on 1920×1080 costs ~50–80ms; even a throttled mid-drag
  // redraw shows up as a periodic freeze. Trailing-only debounce means the
  // dither waits until the user pauses (or releases), so the slider itself
  // stays buttery smooth. Preview "catches up" ~DEBOUNCE_MS after the last
  // state change.
  let drawTimer = 0;
  const DEBOUNCE_MS = 140;
  const scheduleDraw = () => {
    clearTimeout(drawTimer);
    drawTimer = window.setTimeout(() => {
      drawTimer = 0;
      drawPreview();
    }, DEBOUNCE_MS);
  };

  // Still preview: re-render only when something meaningful changes — seek,
  // pause, load, or a relevant setting (dither, output resolution, format).
  // Deliberately NOT updating during playback so we don't pay 1080p dither
  // cost at 60fps.
  //
  // Two effects so listener wiring doesn't churn on every setting change:
  // ─ listener effect re-runs only when videoEl changes
  // ─ settings effect reads the tracked signals and schedules a redraw
  createEffect(() => {
    const v = props.videoEl;
    if (!v) return;
    v.addEventListener('seeked',     scheduleDraw);
    v.addEventListener('loadeddata', scheduleDraw);
    v.addEventListener('pause',      scheduleDraw);
    onCleanup(() => {
      v.removeEventListener('seeked',     scheduleDraw);
      v.removeEventListener('loadeddata', scheduleDraw);
      v.removeEventListener('pause',      scheduleDraw);
    });
  });

  createEffect(() => {
    void appState.dither;
    void appState.width;
    void appState.vidWidth;
    void appState.outputFormat;
    if (!props.videoEl) return;
    scheduleDraw();
  });

  // Live preview loop for non-GIF formats: sample the upstream <video> at the
  // target fps and paint onto the canvas. Gives the user a real "what you'll
  // get" feed — same pan/zoom infrastructure, no dither, accurate scaled
  // resolution and frame rate. Stops when the format is GIF (the dither
  // pipeline above handles that case with its own debounced still render).
  let videoLoopRaf = 0;
  let lastFrameTime = 0;
  const videoTick = (now: number) => {
    videoLoopRaf = requestAnimationFrame(videoTick);
    const targetFps = Math.max(1, Math.min(120, Math.round(appState.fps) || 24));
    const frameInterval = 1000 / targetFps;
    if (now - lastFrameTime < frameInterval) return;
    lastFrameTime = now;
    drawVideoFrame();
  };
  createEffect(() => {
    const isGif = appState.outputFormat === 'gif';
    cancelAnimationFrame(videoLoopRaf);
    videoLoopRaf = 0;
    if (!isGif && props.videoEl) {
      lastFrameTime = 0;
      videoLoopRaf = requestAnimationFrame(videoTick);
    }
  });

  onCleanup(() => {
    clearTimeout(drawTimer);
    drawTimer = 0;
    cancelAnimationFrame(videoLoopRaf);
  });

  return (
    <div
      ref={containerRef!}
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        flex: '1 1 0',
        'min-height': '0',
        background: BG,
        border: `1px solid ${ACCENT}`,
        overflow: 'clip',
        'box-sizing': 'border-box',
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
              width: `${previewW()}px`,
              height: `${previewH()}px`,
              translate: '-50% -50%',
              border: `1px solid ${ACCENT_75}`,
              // Preserve the true pixel grid when the canvas is zoomed up.
              'image-rendering': 'pixelated',
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
        {/* Target dimensions/fps caption — visible for non-GIF outputs in
            place of the dither dropdown. The live preview below is sampled
            at exactly these target dims + fps, so the caption doubles as a
            legend for what the user is seeing. */}
        <Show when={appState.outputFormat !== 'gif'}>
          <div style={{
            position: 'absolute',
            left: '16px', top: '14px',
            'pointer-events': 'none', 'user-select': 'none',
          }}>
            <Chip size="xs">
              {(() => {
                const d = targetDims();
                const f = Math.round(appState.fps) || 24;
                if (!d) return `preview @ ${f}fps`;
                return `${d.w}×${d.h} @ ${f}fps`;
              })()}
            </Chip>
          </div>
        </Show>
        {/* Dithering dropdown — GIF only */}
        <Show when={appState.outputFormat === 'gif'}>{(() => {
          const ITEM_H = 20;
          const ITEM_GAP = 4;
          const ITEMS_PAD_TOP = 4;
          const BTN_H = 20;
          const nItems = () => DITHER_OPTIONS.filter(o => o.value !== appState.dither).length;
          const closedH = () => BTN_H;
          const openH = () => BTN_H + ITEMS_PAD_TOP + nItems() * ITEM_H + (nItems() - 1) * ITEM_GAP;

          return (
            <div
              onMouseLeave={() => props.isPortrait && setTooltip(null)}
              style={{
                position: 'absolute',
                left: '16px', top: '14px',
                display: 'flex', 'flex-direction': 'column',
                'align-items': 'flex-start',
                overflow: 'hidden',
                height: `${ditherOpen() ? openH() : closedH()}px`,
                transition: 'height 200ms cubic-bezier(0.006, 0.984, 0.000, 1.109)',
                'pointer-events': 'auto',
              }}
            >
              <div onMouseEnter={() => ditherOpen() && setTooltip({ title: currentDither().title, desc: currentDither().desc })}>
                <FormatButton
                  format={displayDither()}
                  open={ditherOpen()}
                  onClick={() => setDitherOpen(o => !o)}
                  spring={{ dur: 0.200, x1: 0.006, y1: 0.984, x2: 0.000, y2: 1.109 }}
                  title="Dither algorithm"
                />
              </div>
              <div style={{
                display: 'flex', 'flex-direction': 'column',
                'align-items': 'flex-start',
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
        })()}</Show>

        {/* Tooltip box — positioned at top-right */}
        <Show when={tooltipVisible()}>
          <div style={{
            position: 'absolute',
            right: '16px', top: '14px',
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
                userAdjusted = true;
                const oldZ = zoom();
                const newZ = Math.min(oldZ * 1.3, 20);
                setPan(p => ({ x: p.x * newZ / oldZ, y: p.y * newZ / oldZ }));
                setZoom(newZ);
              }},
              { label: '−', action: () => {
                userAdjusted = true;
                const oldZ = zoom();
                const newZ = Math.max(oldZ / 1.3, 0.1);
                setPan(p => ({ x: p.x * newZ / oldZ, y: p.y * newZ / oldZ }));
                setZoom(newZ);
              }},
              // Re-arms auto-fit — any subsequent container/preview resize
              // will snap the preview back to the fit scale until the user
              // pan/zooms again.
              { label: '⊙', action: () => { userAdjusted = false; fitToContainer(); } },
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
