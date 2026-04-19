import { Component, For, createSignal, onCleanup, onMount } from 'solid-js';
import { ACCENT, BG, MONO } from '../../../shared/tokens';
import { BAR_HEIGHT, CASCADE_CHARS, randChar, type BarProps } from './common';

// Scrolling hex dump (Image-1 CACHE / PAGE columns) as background texture,
// with a subtle ACCENT fill + a big centered % chip.

const COLS = 120;
const ROWS = 5;

const HexRain: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;
  const [grid, setGrid] = createSignal<string[]>(
    Array.from({ length: COLS * ROWS }, () => randChar(CASCADE_CHARS)),
  );
  let timer: number | undefined;

  onMount(() => {
    timer = window.setInterval(() => {
      setGrid(prev => {
        const next = prev.slice();
        // Re-randomize ~8% of cells each tick → shimmering hex rain
        const count = Math.floor(COLS * ROWS * 0.08);
        for (let i = 0; i < count; i++) {
          const idx = (Math.random() * next.length) | 0;
          next[idx] = randChar(CASCADE_CHARS);
        }
        return next;
      });
    }, 80);
  });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const pct = () => Math.round(p.progress);

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${h()}px`,
        outline: `1px solid ${ACCENT}`,
        background: BG,
        overflow: 'hidden',
        'font-family': MONO,
      }}
    >
      {/* ACCENT fill underneath the hex characters */}
      <div style={{
        position: 'absolute', inset: '0',
        width: `${p.progress}%`,
        background: ACCENT,
        opacity: '0.22',
        transition: 'width 160ms linear',
      }} />

      {/* Hex grid */}
      <div style={{
        position: 'absolute', inset: '0',
        display: 'grid',
        'grid-template-columns': `repeat(${COLS}, 1fr)`,
        'grid-template-rows': `repeat(${ROWS}, 1fr)`,
        color: ACCENT,
        'font-size': '11px',
        'line-height': '1',
        'letter-spacing': '0',
        'font-variant-numeric': 'tabular-nums',
      }}>
        <For each={grid()}>{(ch, i) => {
          const col = i() % COLS;
          const colProgress = (col / COLS) * 100;
          const settled = colProgress < p.progress;
          return (
            <div style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              opacity: settled ? '0.95' : '0.35',
              'font-weight': settled ? '500' : '400',
            }}>
              {ch}
            </div>
          );
        }}</For>
      </div>

      {/* Big centered % inside a BG chip so it reads over the hex rain */}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%, -50%)',
        background: BG,
        border: `1px solid ${ACCENT}`,
        padding: '4px 16px',
        color: ACCENT,
        'font-size': '38px',
        'line-height': '1',
        'font-weight': '500',
        'font-variant-numeric': 'tabular-nums',
        'letter-spacing': '-0.02em',
      }}>
        {pct()}%
      </div>
    </div>
  );
};

export default HexRain;
