// ── Cell type ───────────────────────────────────────────────────────────────
export type CellInfo = { row: number; col: number };

// ── Farthest-point sampling ─────────────────────────────────────────────────
export function farthestPointSample(rows: number, cols: number, count: number): CellInfo[] {
  const allCells: CellInfo[] = [];
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
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

// ── Symbol types ────────────────────────────────────────────────────────────
export type SymbolType = 'cross' | 'dot' | 'vline' | 'hash' | 'diag-r' | 'diag-l' | 'star' | 'ring' | 'square';

// ── Canvas drawing helper ──────────────────────────────────────────────────
export function drawSymbol(
  ctx: CanvasRenderingContext2D,
  type: SymbolType,
  x: number, y: number,
  s: number, sw: number,
  color: string,
) {
  const h = s / 2, q = s * 0.3;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';

  switch (type) {
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
    case 'square':
      ctx.beginPath();
      ctx.rect(x + q, y + q, s - q * 2, s - q * 2);
      ctx.stroke();
      break;
  }
}
