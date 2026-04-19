import { Component, For, createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { ACCENT, BG, MONO } from '../../../shared/tokens';
import { BAR_HEIGHT, randChar, type BarProps } from './common';

// A grid of cells, each flickering through a random character until the
// progress front reaches its column — resolved cells snap to █ blocks
// that trail the fill. The big % number, scrambling into focus, rides on top.

const COLS = 96;
const ROWS = 6;
const STORM_CHARS = '█▓▒░▚▞▟▛▜▙01234567890ABCDEF#*±·';
const SCRAMBLE_CHARS = '0123456789!@#%&*';

const AsciiStorm: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;
  const [tick, setTick] = createSignal(0);
  let timer: number | undefined;
  onMount(() => {
    timer = window.setInterval(() => setTick(t => t + 1), 70);
  });
  onCleanup(() => { if (timer) clearInterval(timer); });

  const grid = createMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    tick();
    const out: string[] = [];
    const front = p.progress;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const colT = (c / COLS) * 100;
        if (colT < front - 6) {
          // Deep inside the resolved zone — solid blocks.
          out.push(Math.random() < 0.08 ? '▓' : '█');
        } else if (colT < front) {
          // Edge of the front — mix of block + flickering.
          out.push(Math.random() < 0.5 ? '█' : randChar(STORM_CHARS));
        } else {
          // Ahead of the front — random storm.
          out.push(randChar(STORM_CHARS));
        }
      }
    }
    return out;
  });

  // Scrambled display of the % number — resolved digits stick, trailing
  // digits jitter until progress gets close.
  const pctText = createMemo(() => {
    const target = Math.round(p.progress).toString().padStart(3, ' ') + '%';
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    tick();
    return target.split('').map(ch => {
      if (ch === ' ' || ch === '%') return ch;
      return Math.random() < 0.82 ? ch : randChar(SCRAMBLE_CHARS);
    }).join('');
  });

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${h()}px`,
        outline: `1px solid ${ACCENT}`,
        background: BG,
        'font-family': MONO,
        overflow: 'hidden',
      }}
    >
      <div style={{
        position: 'absolute', inset: '0',
        display: 'grid',
        'grid-template-columns': `repeat(${COLS}, 1fr)`,
        'grid-template-rows': `repeat(${ROWS}, 1fr)`,
        color: ACCENT,
        'font-size': '11px',
        'line-height': '1',
      }}>
        <For each={grid()}>{(ch, i) => {
          const col = i() % COLS;
          const colT = (col / COLS) * 100;
          const resolved = colT < p.progress - 4;
          return (
            <div style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              opacity: resolved ? '0.95' : colT < p.progress ? '0.75' : '0.35',
            }}>
              {ch}
            </div>
          );
        }}</For>
      </div>
      <div style={{
        position: 'absolute',
        right: '16px', top: '50%',
        transform: 'translateY(-50%)',
        background: BG,
        border: `1px solid ${ACCENT}`,
        color: ACCENT,
        padding: '2px 10px',
        'font-size': '38px',
        'line-height': '1',
        'font-weight': '500',
        'font-variant-numeric': 'tabular-nums',
        'letter-spacing': '-0.02em',
      }}>
        {pctText()}
      </div>
    </div>
  );
};

export default AsciiStorm;
