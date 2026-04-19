import { Component } from 'solid-js';
import { ACCENT, BG, MONO } from '../../../shared/tokens';
import { BAR_HEIGHT, type BarProps } from './common';

const SolidFill: Component<BarProps> = (p) => {
  const h = () => p.height ?? BAR_HEIGHT;
  const pct = () => Math.round(p.progress);
  const label = () => `${pct()}%`;
  const fontSize = () => Math.max(24, Math.min(64, Math.round(h() * 0.55)));

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
      <div
        style={{
          position: 'absolute',
          top: '0', left: '0', bottom: '0',
          width: `${p.progress}%`,
          background: ACCENT,
          transition: 'width 160ms linear',
        }}
      />
      <div
        style={{
          position: 'absolute', inset: '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          color: ACCENT,
          'font-size': `${fontSize()}px`,
          'font-weight': '500',
          'letter-spacing': '-0.02em',
          'font-variant-numeric': 'tabular-nums',
        }}
      >
        {label()}
      </div>
      <div
        style={{
          position: 'absolute', inset: '0',
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'center',
          color: BG,
          'font-size': `${fontSize()}px`,
          'font-weight': '500',
          'letter-spacing': '-0.02em',
          'font-variant-numeric': 'tabular-nums',
          'clip-path': `inset(0 ${100 - p.progress}% 0 0)`,
          transition: 'clip-path 160ms linear',
        }}
      >
        {label()}
      </div>
    </div>
  );
};

export default SolidFill;
