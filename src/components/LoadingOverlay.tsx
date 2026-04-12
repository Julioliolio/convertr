import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';

// ── Config ─────────────────────────────────────────────────────────────────
const CELL_SIZE     = 24;
const STROKE_W      = 1;
const SYMBOL        = 'star' as const;
const COLOR         = '#fc006d';
const LINGER_COUNT  = 16;
const LINGER_DUR    = 0.5;    // seconds
const FLICKER_SPEED = 75;     // ms per flicker toggle

// ── Types ──────────────────────────────────────────────────────────────────
type CellInfo = { row: number; col: number };

// ── Canvas drawing helpers ─────────────────────────────────────────────────
function drawSymbol(
  ctx: CanvasRenderingContext2D,
  x: number, y: number,
  s: number, sw: number,
  color: string,
) {
  const h = s / 2, q = s * 0.3;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';

  switch (SYMBOL) {
    case 'cross':
      ctx.beginPath();
      ctx.moveTo(x + h, y + sw); ctx.lineTo(x + h, y + s - sw);
      ctx.moveTo(x + sw, y + h); ctx.lineTo(x + s - sw, y + h);
      ctx.stroke();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(x + h, y + h, sw + 0.5, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'vline':
      ctx.beginPath();
      ctx.moveTo(x + h, y + q); ctx.lineTo(x + h, y + s - q);
      ctx.stroke();
      break;
    case 'hash':
      ctx.beginPath();
      ctx.moveTo(x + s * 0.35, y + q); ctx.lineTo(x + s * 0.35, y + s - q);
      ctx.moveTo(x + s * 0.65, y + q); ctx.lineTo(x + s * 0.65, y + s - q);
      ctx.moveTo(x + q, y + s * 0.35); ctx.lineTo(x + s - q, y + s * 0.35);
      ctx.moveTo(x + q, y + s * 0.65); ctx.lineTo(x + s - q, y + s * 0.65);
      ctx.stroke();
      break;
    case 'diag-r':
      ctx.beginPath();
      ctx.moveTo(x + q, y + s - q); ctx.lineTo(x + s - q, y + q);
      ctx.stroke();
      break;
    case 'diag-l':
      ctx.beginPath();
      ctx.moveTo(x + q, y + q); ctx.lineTo(x + s - q, y + s - q);
      ctx.stroke();
      break;
    case 'star':
      ctx.beginPath();
      ctx.moveTo(x + h, y + q); ctx.lineTo(x + h, y + s - q);
      ctx.moveTo(x + q, y + h); ctx.lineTo(x + s - q, y + h);
      ctx.moveTo(x + q, y + q); ctx.lineTo(x + s - q, y + s - q);
      ctx.moveTo(x + s - q, y + q); ctx.lineTo(x + q, y + s - q);
      ctx.stroke();
      break;
    case 'ring': {
      const r = s * 0.3;
      ctx.beginPath();
      ctx.arc(x + h, y + h, r, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
  }
}

// ── Farthest-point sampling ────────────────────────────────────────────────
function selectLingerCells(gRows: number, gCols: number, count: number): CellInfo[] {
  const allCells: CellInfo[] = [];
  for (let r = 0; r < gRows; r++)
    for (let c = 0; c < gCols; c++)
      allCells.push({ row: r, col: c });

  const n = Math.min(count, allCells.length);
  if (n === 0) return [];

  const picked: CellInfo[] = [];
  const remaining = [...allCells];

  const firstIdx = Math.floor(Math.random() * remaining.length);
  picked.push(remaining.splice(firstIdx, 1)[0]);

  const minDist = new Float64Array(remaining.length);
  for (let i = 0; i < remaining.length; i++) {
    const dr = remaining[i].row - picked[0].row;
    const dc = remaining[i].col - picked[0].col;
    minDist[i] = dr * dr + dc * dc;
  }

  while (picked.length < n && remaining.length > 0) {
    let bestIdx = 0, bestDist = minDist[0];
    for (let i = 1; i < remaining.length; i++) {
      if (minDist[i] > bestDist) { bestDist = minDist[i]; bestIdx = i; }
    }
    const chosen = remaining[bestIdx];
    picked.push(chosen);
    remaining.splice(bestIdx, 1);

    const newMinDist = new Float64Array(remaining.length);
    for (let i = 0; i < remaining.length; i++) {
      const old = i < bestIdx ? minDist[i] : minDist[i + 1];
      const dr = remaining[i].row - chosen.row;
      const dc = remaining[i].col - chosen.col;
      newMinDist[i] = Math.min(old, dr * dr + dc * dc);
    }
    minDist.set(newMinDist);
  }

  return picked;
}

// ── Component ──────────────────────────────────────────────────────────────
const LoadingOverlay: Component<{
  width: number;
  height: number;
  progress: number;
  progressMsg: string;
  onDone?: () => void;
  delay?: number;
}> = (p) => {
  let lingerCells: CellInfo[] = [];
  let startTime = 0;
  let rafId = 0;
  let delayTimer: number | undefined;
  // Measured on-screen dimensions (set in onMount)
  let vw = 0;
  let vh = 0;

  const [done, setDone] = createSignal(false);
  let canvasRef!: HTMLCanvasElement;

  function drawFrame(ctx: CanvasRenderingContext2D, now: number) {
    const s = CELL_SIZE;
    ctx.clearRect(0, 0, vw, vh);

    const flickerOn = Math.floor((now - startTime) / FLICKER_SPEED) % 2 === 0;
    if (flickerOn) {
      for (const cell of lingerCells) {
        drawSymbol(ctx, cell.col * s, cell.row * s, s, STROKE_W, COLOR);
      }
    }
  }

  function loop(now: number) {
    if (now - startTime >= LINGER_DUR * 1000) {
      setDone(true);
      p.onDone?.();
      return;
    }

    const ctx = canvasRef?.getContext('2d');
    if (ctx) drawFrame(ctx, now);

    rafId = requestAnimationFrame(loop);
  }

  onMount(() => {
    // Measure the parent container — not the canvas — for reliable dimensions
    const parent = canvasRef.parentElement!;
    const rect = parent.getBoundingClientRect();
    vw = rect.width;
    vh = rect.height;
    const gCols = Math.ceil(vw / CELL_SIZE);
    const gRows = Math.ceil(vh / CELL_SIZE);

    const dpr = window.devicePixelRatio || 1;
    // Set backing store to match container exactly
    canvasRef.width = Math.ceil(vw * dpr);
    canvasRef.height = Math.ceil(vh * dpr);
    // Set CSS size explicitly in pixels — avoids any stretching from width:100%/height:100%
    canvasRef.style.width = `${vw}px`;
    canvasRef.style.height = `${vh}px`;
    const ctx = canvasRef.getContext('2d')!;
    ctx.scale(dpr, dpr);

    lingerCells = selectLingerCells(gRows, gCols, LINGER_COUNT);

    const start = () => {
      startTime = performance.now();
      rafId = requestAnimationFrame(loop);
    };

    const ms = p.delay ?? 0;
    if (ms > 0) {
      delayTimer = window.setTimeout(start, ms);
    } else {
      start();
    }
  });

  onCleanup(() => {
    if (rafId) cancelAnimationFrame(rafId);
    if (delayTimer !== undefined) clearTimeout(delayTimer);
  });

  return (
    <Show when={!done()}>
      <canvas
        ref={canvasRef!}
        style={{
          position: 'absolute',
          inset: '0',
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
    </Show>
  );
};

export default LoadingOverlay;
