import { Component, createSignal, createEffect, For } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import BatchThumbnail, { type BatchFile, extractVideoFrame } from './BatchThumbnail';

// ── Public API ─────────────────────────────────────────────────────────────
// Parked component — not wired into the main app. Kept here so we can resume
// batch work later without digging it back out of git history. The playground
// drives it via `apiRef` for dev iteration.
export type BatchCanvasApi = {
  addMockFiles: (n: number) => void;
  clearFiles: () => void;
};

// ── Mock thumbnail generator ───────────────────────────────────────────────
// Playground-only. Real uploads go through extractVideoFrame in
// BatchThumbnail.tsx and produce a real poster frame from the video file.
const MOCK_FORMATS = ['MOV', 'MP4', 'GIF', 'AVI', 'WEBM', 'MKV'];
const MOCK_HUES = [12, 42, 75, 120, 160, 200, 240, 280, 320, 350];

let _mockCounter = 0;
const generateMockThumbnail = (): BatchFile => {
  _mockCounter++;
  const hue = MOCK_HUES[Math.floor(Math.random() * MOCK_HUES.length)];
  const format = MOCK_FORMATS[Math.floor(Math.random() * MOCK_FORMATS.length)];
  const c = document.createElement('canvas');
  c.width = 250; c.height = 350;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 250, 350);
  grad.addColorStop(0, `hsl(${hue} 70% 75%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360} 60% 90%)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 250, 350);
  // Random accent shapes so thumbnails are visually distinct
  ctx.fillStyle = `hsla(${(hue + 180) % 360} 70% 40% / 0.35)`;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * 250, Math.random() * 350, 20 + Math.random() * 40, 0, Math.PI * 2);
    ctx.fill();
  }
  // Fake size between ~500 KB and ~12 MB so the caption reads naturally
  const size = Math.floor(500_000 + Math.random() * 11_500_000);
  return {
    name: `mock_${String(_mockCounter).padStart(3, '0')}.${format.toLowerCase()}`,
    type: format,
    url: c.toDataURL('image/png'),
    size,
  };
};

// ── ADD FILES bar icon ─────────────────────────────────────────────────────
const PlusSvg: Component = () => (
  <svg width="17" height="19" viewBox="0 0 79 88" fill="none"
    style={{ width: '17px', height: 'auto', 'flex-shrink': '0' }}>
    <rect x="0" width="78.198" height="87.165" fill="rgba(252,3,109,0)" />
    <path d="M42.206 40.779L42.183 70.802L36.178 70.806L36.196 46.788L12.178 46.806L12.183 40.802L42.206 40.779Z" fill={ACCENT} />
    <path d="M35.993 46.386L36.016 16.363L42.021 16.359L42.003 40.377L66.02 40.359L66.015 46.363L35.993 46.386Z" fill={ACCENT} />
  </svg>
);

// ── Component ──────────────────────────────────────────────────────────────
const BatchCanvas: Component<{
  apiRef?: (api: BatchCanvasApi) => void;
  /** Distance in px from the top of the canvas to the first row of
   *  thumbnails. Defaults to 48. */
  topOffset?: number;
  /** Px cut off the bottom of a hovered thumbnail to reveal its caption. */
  hoverCutoff?: number;
  /** Thickness of the pink frame drawn around a selected thumbnail. */
  selectedBorder?: number;
}> = (props) => {
  const [batchFiles, setBatchFiles] = createSignal<BatchFile[]>([]);
  const [selectedIdx, setSelectedIdx] = createSignal<number | null>(null);

  const [batchPan, setBatchPan] = createSignal({ x: 0, y: 0 });
  const [batchDragging, setBatchDragging] = createSignal(false);
  let batchDragStart = { x: 0, y: 0, px: 0, py: 0 };
  let batchDidDrag = false;
  let batchContentRef: HTMLDivElement | undefined;
  let containerRef!: HTMLDivElement;
  let fileInputRef!: HTMLInputElement;

  // ── Layout constants ─────────────────────────────────────────────────────
  const CONTENT_LEFT = 16;
  const contentTop = () => props.topOffset ?? 48;
  const MARGIN_RIGHT = 16;
  // ADD FILES bar (20) + bottom padding (8) + breathing (8)
  const MARGIN_BOTTOM = 36;

  // ── Bounded pan ──────────────────────────────────────────────────────────
  const clampPan = (x: number, y: number) => {
    if (!batchContentRef || !containerRef) return { x, y };
    const vw = containerRef.clientWidth;
    const vh = containerRef.clientHeight;
    const cw = batchContentRef.offsetWidth;
    const ch = batchContentRef.offsetHeight;
    const visW = vw - CONTENT_LEFT - MARGIN_RIGHT;
    const visH = vh - contentTop() - MARGIN_BOTTOM;
    const minX = cw > visW ? visW - cw : 0;
    const minY = ch > visH ? visH - ch : 0;
    return {
      x: Math.max(minX, Math.min(0, x)),
      y: Math.max(minY, Math.min(0, y)),
    };
  };

  const handleWheel = (e: WheelEvent) => {
    e.preventDefault();
    const p = batchPan();
    setBatchPan(clampPan(p.x - e.deltaX, p.y - e.deltaY));
  };

  const handlePointerDown = (e: PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    batchDidDrag = false;
    setBatchDragging(true);
    batchDragStart = { x: e.clientX, y: e.clientY, px: batchPan().x, py: batchPan().y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: PointerEvent) => {
    if (!batchDragging()) return;
    const dx = e.clientX - batchDragStart.x;
    const dy = e.clientY - batchDragStart.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) batchDidDrag = true;
    setBatchPan(clampPan(batchDragStart.px + dx, batchDragStart.py + dy));
  };

  const handlePointerUp = () => setBatchDragging(false);

  // Re-clamp when files change or top offset changes. rAF so the DOM has
  // measured the new content before we ask it for offsetWidth/Height.
  createEffect(() => {
    batchFiles();
    contentTop();
    requestAnimationFrame(() => {
      const p = batchPan();
      const c = clampPan(p.x, p.y);
      if (c.x !== p.x || c.y !== p.y) setBatchPan(c);
    });
  });

  // ── Imperative API (for dev playground controls) ─────────────────────────
  if (props.apiRef) {
    props.apiRef({
      addMockFiles: (n: number) => {
        const newMocks = Array.from({ length: n }, generateMockThumbnail);
        setBatchFiles(prev => [...prev, ...newMocks]);
      },
      clearFiles: () => {
        for (const f of batchFiles()) {
          if (f.url.startsWith('blob:')) URL.revokeObjectURL(f.url);
        }
        setBatchFiles([]);
        setSelectedIdx(null);
      },
    });
  }

  // ── File upload → real frame extraction ─────────────────────────────────
  const handleAddFiles = () => fileInputRef.click();

  const handleFilesSelected = (e: Event) => {
    const input = e.target as HTMLInputElement;
    if (!input.files) return;
    const files = Array.from(input.files);
    // Insert placeholders with empty url; BatchThumbnail renders a LOADING tile
    // until extractVideoFrame resolves with the real poster dataURL.
    const placeholders: BatchFile[] = files.map(f => ({
      name: f.name,
      type: f.name.split('.').pop()?.toUpperCase() || '?',
      url: '',
      size: f.size,
    }));
    const startIdx = batchFiles().length;
    setBatchFiles(prev => [...prev, ...placeholders]);
    input.value = '';

    files.forEach((f, i) => {
      extractVideoFrame(f)
        .then(url => {
          setBatchFiles(prev => {
            if (!prev[startIdx + i]) return prev;
            const next = prev.slice();
            next[startIdx + i] = { ...next[startIdx + i], url };
            return next;
          });
        })
        .catch(err => {
          // Leave url empty → the thumbnail keeps its LOADING placeholder.
          console.warn('[batch] frame extraction failed for', f.name, err);
        });
    });
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef!}
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
      {/* Fixed dotted background */}
      <div style={{
        position: 'absolute', inset: '0',
        'background-color': BG,
        'background-image': `radial-gradient(circle, ${ACCENT} 1px, transparent 1px)`,
        'background-size': '32px 32px',
      }} />

      {/* Pannable viewport — covers the whole canvas, clips content */}
      <div
        style={{
          position: 'absolute', inset: '0',
          overflow: 'hidden',
          cursor: batchDragging() ? 'grabbing' : 'grab',
          'touch-action': 'none',
        }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        {/* Content layer — translated by pan, centers files */}
        <div
          style={{
            position: 'absolute',
            left: `${CONTENT_LEFT}px`, top: `${contentTop()}px`,
            width: `calc(100% - ${CONTENT_LEFT + MARGIN_RIGHT}px)`,
            display: 'flex', 'justify-content': 'center',
            transform: `translate(${batchPan().x}px, ${batchPan().y}px)`,
            'will-change': 'transform',
          }}
        >
          <div
            ref={batchContentRef!}
            style={{
              display: 'flex', gap: '24px',
              'flex-wrap': 'wrap',
              'justify-content': 'center',
              'align-items': 'flex-start',
              'max-width': '100%',
            }}
          >
            <For each={batchFiles()}>
              {(file, idx) => (
                <BatchThumbnail
                  file={file}
                  selected={selectedIdx() === idx()}
                  hoverCutoff={props.hoverCutoff}
                  selectedBorder={props.selectedBorder}
                  onClick={() => setSelectedIdx(selectedIdx() === idx() ? null : idx())}
                />
              )}
            </For>
          </div>
        </div>
      </div>

      {/* ADD FILES bar */}
      <div
        style={{
          position: 'absolute',
          left: '8px', right: '8px', bottom: '8px',
          display: 'flex',
          'justify-content': 'space-between',
          'align-items': 'center',
          border: `1px solid ${ACCENT}`,
          background: BG,
          gap: '4px',
          cursor: 'pointer',
          'z-index': '2',
        }}
        onClick={handleAddFiles}
      >
        <PlusSvg />
        <span style={{
          'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
          color: ACCENT,
        }}>
          ADD FILES
        </span>
        <PlusSvg />
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*"
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />
    </div>
  );
};

export default BatchCanvas;
