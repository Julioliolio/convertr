import { Component, For } from 'solid-js';
import { ACCENT, ACCENT_25, BG, MONO } from '../../shared/tokens';
import { BAR_HEIGHT, type BarProps } from './common';

// Bricks-only take on option 5: the CARRIER sine-wave row is gone and the
// segmented fill occupies the full bar height, so each brick reads as a
// proper chunky block. No % readout — just the squares filling left → right.

const BRICKS = 48;

const CarrierBricks: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: `${h()}px`,
        outline: `1px solid ${ACCENT}`,
        background: BG,
        'font-family': MONO,
        display: 'flex',
        'align-items': 'stretch',
        padding: '10px 12px',
        'box-sizing': 'border-box',
        gap: '3px',
        overflow: 'hidden',
      }}
    >
      <For each={Array.from({ length: BRICKS })}>{(_, i) => {
        const t = (i() / BRICKS) * 100;
        const lit = () => t < p.progress;
        return (
          <div style={{
            flex: '1',
            background: lit() ? ACCENT : 'transparent',
            border: `1px solid ${lit() ? ACCENT : ACCENT_25}`,
            transition: 'background 100ms ease, border-color 100ms ease',
          }} />
        );
      }}</For>
    </div>
  );
};

export default CarrierBricks;
