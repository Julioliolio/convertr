import { Component, createSignal, onMount, onCleanup, Show } from 'solid-js';
import { drawSymbol, farthestPointSample, type SymbolType, type CellInfo } from '../shared/symbols';

// ── Config ─────────────────────────────────────────────────────────────────
const CELL_SIZE     = 24;
const STROKE_W      = 1;
const SYMBOL: SymbolType = 'square';
const COLOR         = '#fc006d';
const LINGER_COUNT  = 2;
const LINGER_DUR    = 0.5;    // seconds
const FLICKER_SPEED = 75;     // ms per flicker toggle

// ── Tile dimensions (in cells) — pattern repeats across the canvas ─────────
const TILE_COLS = 12;
const TILE_ROWS = 8;

// ── Tile the pattern across the full canvas ────────────────────────────────
function buildTiledCells(gRows: number, gCols: number, pattern: CellInfo[]): CellInfo[] {
  const cells: CellInfo[] = [];
  for (let tileRow = 0; tileRow * TILE_ROWS < gRows; tileRow++) {
    for (let tileCol = 0; tileCol * TILE_COLS < gCols; tileCol++) {
      for (const p of pattern) {
        const row = tileRow * TILE_ROWS + p.row;
        const col = tileCol * TILE_COLS + p.col;
        if (row < gRows && col < gCols) {
          cells.push({ row, col });
        }
      }
    }
  }
  return cells;
}

// ── Component ──────────────────────────────────────────────────────────────
const LoadingOverlay: Component<{
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
        drawSymbol(ctx, SYMBOL, cell.col * s, cell.row * s, s, STROKE_W, COLOR);
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

  function setupCanvas() {
    // Measure at animation start — layout is fully resolved by now
    const rect = canvasRef.getBoundingClientRect();
    vw = rect.width;
    vh = rect.height;

    const dpr = window.devicePixelRatio || 1;
    canvasRef.width = Math.ceil(vw * dpr);
    canvasRef.height = Math.ceil(vh * dpr);
    const ctx = canvasRef.getContext('2d')!;
    ctx.scale(dpr, dpr);

    const gCols = Math.ceil(vw / CELL_SIZE);
    const gRows = Math.ceil(vh / CELL_SIZE);
    const tilePattern = farthestPointSample(TILE_ROWS, TILE_COLS, LINGER_COUNT);
    lingerCells = buildTiledCells(gRows, gCols, tilePattern);

    startTime = performance.now();
    rafId = requestAnimationFrame(loop);
  }

  onMount(() => {
    const ms = p.delay ?? 0;
    if (ms > 0) {
      delayTimer = window.setTimeout(setupCanvas, ms);
    } else {
      // Even with no delay, defer to next frame so layout resolves
      rafId = requestAnimationFrame(() => setupCanvas());
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
