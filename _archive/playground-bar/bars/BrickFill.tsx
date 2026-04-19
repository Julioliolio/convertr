import { Component, For, createMemo } from 'solid-js';
import { ACCENT, BG, MONO } from '../../../shared/tokens';
import { BAR_HEIGHT, type BarProps } from './common';

// Image-2-style chunky segmented bars. Varied widths evoke the
// histogram-of-orange-blocks look from the reference.
const BRICKS: { w: number; gap: number }[] = (() => {
  const rng = mulberry32(1337);
  const out: { w: number; gap: number }[] = [];
  let total = 0;
  while (total < 100) {
    const w = 0.8 + rng() * 3.2; // 0.8%..4%
    const gap = 0.25 + rng() * 0.5;
    out.push({ w, gap });
    total += w + gap;
  }
  return out;
})();

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BrickFill: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;
  const pct = () => Math.round(p.progress);

  // Precompute cumulative positions so each brick knows whether it has been
  // passed by the progress threshold.
  const cum = createMemo(() => {
    const arr: number[] = [];
    let x = 0;
    for (const b of BRICKS) { arr.push(x); x += b.w + b.gap; }
    return arr;
  });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${h()}px`,
        outline: `1px solid ${ACCENT}`,
        background: BG,
        display: 'flex',
        'align-items': 'stretch',
        padding: '10px 12px',
        'box-sizing': 'border-box',
        'font-family': MONO,
      }}
    >
      <div style={{ position: 'relative', flex: '1', display: 'flex', 'align-items': 'stretch' }}>
        <For each={BRICKS}>{(b, i) => {
          const lit = () => cum()[i()] < p.progress;
          return (
            <div
              style={{
                width: `${b.w}%`,
                'margin-right': `${b.gap}%`,
                background: lit() ? ACCENT : 'transparent',
                border: `1px solid ${lit() ? ACCENT : 'rgba(252,0,109,0.25)'}`,
                transition: 'background 120ms ease, border-color 120ms ease',
              }}
            />
          );
        }}</For>
      </div>
      <div
        style={{
          'padding-left': '14px',
          display: 'flex',
          'align-items': 'center',
          color: ACCENT,
          'font-size': '32px',
          'font-weight': '500',
          'font-variant-numeric': 'tabular-nums',
          'min-width': '86px',
          'justify-content': 'flex-end',
        }}
      >
        {pct()}%
      </div>
    </div>
  );
};

export default BrickFill;
