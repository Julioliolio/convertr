// ── Symbol types ────────────────────────────────────────────────────────────
export type SymbolType = 'cross' | 'dot' | 'vline' | 'hash' | 'diag-r' | 'diag-l' | 'star' | 'ring' | 'square';

export const ALL_SYMBOLS: { id: SymbolType; label: string }[] = [
  { id: 'cross',  label: '+' },
  { id: 'dot',    label: '.' },
  { id: 'vline',  label: '|' },
  { id: 'hash',   label: '#' },
  { id: 'diag-r', label: '/' },
  { id: 'diag-l', label: '\\' },
  { id: 'star',   label: '*' },
  { id: 'ring',   label: 'o' },
  { id: 'square', label: '□' },
];

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
