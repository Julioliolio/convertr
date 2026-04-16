import { Component, createSignal, Show, onCleanup } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { CtrlSlider } from '../../shared/ui';
import DesignSlider, { type TickMark, type NotchParams, type ThumbParams } from '../controls/DesignSlider';

// The DesignSlider component itself lives in src/components/controls/DesignSlider.tsx.
// This file only hosts the live tuning panel (notch/thumb/snap knobs + easing curve editor).

// ── Bezier curve editor ──────────────────────────────────────────────────────

const EASING_PRESETS = [
  { label: 'linear',      x1: 0,    y1: 0,    x2: 1,    y2: 1    },
  { label: 'ease',        x1: 0.25, y1: 0.1,  x2: 0.25, y2: 1    },
  { label: 'ease-in',     x1: 0.42, y1: 0,    x2: 1,    y2: 1    },
  { label: 'ease-out',    x1: 0,    y1: 0,    x2: 0.58, y2: 1    },
  { label: 'ease-in-out', x1: 0.42, y1: 0,    x2: 0.58, y2: 1    },
  { label: 'spring',      x1: 0.34, y1: 1.56, x2: 0.64, y2: 1    },
];

const BezierEditor: Component<{
  x1: number; y1: number; x2: number; y2: number;
  onChange: (x1: number, y1: number, x2: number, y2: number) => void;
}> = (p) => {
  const S = 160, PAD = 20;
  const OVER = 60; // extra space for overshoot above and below
  const VB_X = 0, VB_Y = -OVER, VB_W = S + PAD * 2, VB_H = S + PAD * 2 + OVER * 2;

  const bx = (v: number) => PAD + v * S;
  const by = (v: number) => PAD + (1 - v) * S;

  const fromSvg = (sx: number, sy: number) => [
    Math.max(0, Math.min(1, (sx - PAD) / S)),
    (PAD + S - sy) / S,
  ] as const;

  let svgEl: SVGSVGElement | undefined;
  let dragging: 1 | 2 | null = null;

  const getSvgPos = (e: MouseEvent) => {
    const r = svgEl!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width * VB_W + VB_X, (e.clientY - r.top) / r.height * VB_H + VB_Y] as const;
  };

  const onMove = (e: MouseEvent) => {
    if (!dragging) return;
    const [sx, sy] = getSvgPos(e);
    const [x, y] = fromSvg(sx, sy);
    if (dragging === 1) p.onChange(x, y, p.x2, p.y2);
    else                p.onChange(p.x1, p.y1, x, y);
  };
  const onUp = () => {
    dragging = null;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
  };
  const startDrag = (handle: 1 | 2) => (e: MouseEvent) => {
    e.preventDefault();
    dragging = handle;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  onCleanup(() => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); });

  const curve = () => `M ${bx(0)} ${by(0)} C ${bx(p.x1)} ${by(p.y1)} ${bx(p.x2)} ${by(p.y2)} ${bx(1)} ${by(1)}`;

  const GRID = [0.25, 0.5, 0.75];

  return (
    <svg ref={svgEl!} viewBox={`${VB_X} ${VB_Y} ${VB_W} ${VB_H}`} width={200} height={200} style={{ display: 'block', 'user-select': 'none', overflow: 'visible' }}>
      <rect x={PAD} y={PAD} width={S} height={S} fill="#0a0a0a" stroke="#222" stroke-width="1" />
      {GRID.map(t => <>
        <line x1={bx(t)} y1={PAD} x2={bx(t)} y2={PAD + S} stroke="#1a1a1a" stroke-width="1" />
        <line x1={PAD} y1={by(t)} x2={PAD + S} y2={by(t)} stroke="#1a1a1a" stroke-width="1" />
      </>)}
      <line x1={bx(0)} y1={by(0)} x2={bx(1)} y2={by(1)} stroke="#2a2a2a" stroke-width="1" stroke-dasharray="3 3" />
      <line x1={bx(0)} y1={by(0)} x2={bx(p.x1)} y2={by(p.y1)} stroke="#3a3a3a" stroke-width="1" />
      <line x1={bx(1)} y1={by(1)} x2={bx(p.x2)} y2={by(p.y2)} stroke="#3a3a3a" stroke-width="1" />
      <path d={curve()} fill="none" stroke={ACCENT} stroke-width="2" stroke-linecap="round" />
      <circle cx={bx(0)} cy={by(0)} r={3} fill="#444" />
      <circle cx={bx(1)} cy={by(1)} r={3} fill="#444" />
      <circle cx={bx(p.x1)} cy={by(p.y1)} r={5} fill={ACCENT} style={{ cursor: 'grab' }} onMouseDown={startDrag(1)} />
      <circle cx={bx(p.x2)} cy={by(p.y2)} r={5} fill={ACCENT} style={{ cursor: 'grab' }} onMouseDown={startDrag(2)} />
    </svg>
  );
};

// ── Control widgets ──────────────────────────────────────────────────────────

const Section: Component<{ title: string; children: any }> = (p) => {
  const [open, setOpen] = createSignal(false);
  return (
    <div style={{ 'border-bottom': '1px solid #222' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', 'align-items': 'center', gap: '6px',
          width: '100%', background: 'none', border: 'none',
          color: '#888', cursor: 'pointer', padding: '8px 0',
          'font-family': MONO, 'font-size': '11px',
        }}
      >
        <span style={{
          display: 'inline-block', transition: 'transform 0.15s',
          transform: open() ? 'rotate(90deg)' : 'rotate(0deg)',
          color: ACCENT,
        }}>
          ▶
        </span>
        {p.title}
      </button>
      <Show when={open()}>
        <div style={{ padding: '0 0 12px 0', display: 'flex', gap: '16px' }}>
          {p.children}
        </div>
      </Show>
    </div>
  );
};

const EasingPanel: Component<{
  x1: number; y1: number; x2: number; y2: number;
  onChange: (x1: number, y1: number, x2: number, y2: number) => void;
}> = (p) => (
  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px', 'align-items': 'center' }}>
    <BezierEditor x1={p.x1} y1={p.y1} x2={p.x2} y2={p.y2} onChange={p.onChange} />
    <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '4px', 'max-width': '200px', 'justify-content': 'center' }}>
      {EASING_PRESETS.map(preset => (
        <button
          onClick={() => p.onChange(preset.x1, preset.y1, preset.x2, preset.y2)}
          style={{
            background: 'transparent', border: '1px solid #333', color: '#888',
            'font-family': MONO, 'font-size': '10px', padding: '2px 6px',
            cursor: 'pointer',
          }}
        >
          {preset.label}
        </button>
      ))}
    </div>
  </div>
);

// ── Playground ───────────────────────────────────────────────────────────────

const SliderPlayground: Component = () => {
  const [width, setWidth] = createSignal(1080);
  const [fps, setFps] = createSignal(12);

  // Notch animation params
  const [notchIdleW, setNotchIdleW] = createSignal(6);
  const [notchIdleH, setNotchIdleH] = createSignal(12);
  const [notchDragH, setNotchDragH] = createSignal(6);
  const [notchDur, setNotchDur] = createSignal(150);
  const [ncx1, setNcx1] = createSignal(0.33);
  const [ncy1, setNcy1] = createSignal(0.595);
  const [ncx2, setNcx2] = createSignal(0.599);
  const [ncy2, setNcy2] = createSignal(1.17);

  const notchEasing = () => `cubic-bezier(${ncx1().toFixed(3)}, ${ncy1().toFixed(3)}, ${ncx2().toFixed(3)}, ${ncy2().toFixed(3)})`;

  // Snap params
  const [snapRadius, setSnapRadius] = createSignal(5);

  // Thumb slide params
  const [thumbDur, setThumbDur] = createSignal(250);
  const [tcx1, setTcx1] = createSignal(0.631);
  const [tcy1, setTcy1] = createSignal(0.013);
  const [tcx2, setTcx2] = createSignal(0);
  const [tcy2, setTcy2] = createSignal(0.993);

  // Copy
  const [copyState, setCopyState] = createSignal<'idle' | 'ok' | 'err'>('idle');
  const copyValues = () => {
    const text = [
      `notch: { idleW: ${notchIdleW()}, idleH: ${notchIdleH()}, dragH: ${notchDragH()}, dur: ${notchDur()}, x1: ${ncx1().toFixed(3)}, y1: ${ncy1().toFixed(3)}, x2: ${ncx2().toFixed(3)}, y2: ${ncy2().toFixed(3)} }`,
      `snap: { radius: ${snapRadius()} }`,
      `thumb: { dur: ${thumbDur()}, x1: ${tcx1().toFixed(3)}, y1: ${tcy1().toFixed(3)}, x2: ${tcx2().toFixed(3)}, y2: ${tcy2().toFixed(3)} }`,
    ].join('\n');
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopyState('ok');
    } catch { setCopyState('err'); }
    setTimeout(() => setCopyState('idle'), 2500);
  };

  const notch = (): NotchParams => ({
    notchIdleW: notchIdleW(),
    notchIdleH: notchIdleH(),
    notchDragH: notchDragH(),
    duration: notchDur(),
    easing: notchEasing(),
  });

  const thumb = (): ThumbParams => ({
    duration: thumbDur(),
    x1: tcx1(), y1: tcy1(), x2: tcx2(), y2: tcy2(),
  });

  const widthTicks: TickMark[] = [
    { value: 0,    label: '0' },
    { value: 500,  label: '500' },
    { value: 750,  label: '750' },
    { value: 1080, label: '1080' },
    { value: 1920, label: '1920' },
  ];

  const fpsTicks: TickMark[] = [
    { value: 0,  label: '0' },
    { value: 12, label: '12' },
    { value: 24, label: '24' },
    { value: 60, label: '60' },
  ];

  return (
    <div style={{
      background: BG,
      'min-height': '100vh',
      display: 'flex',
      'flex-direction': 'column',
      'align-items': 'center',
      'justify-content': 'center',
      gap: '32px',
      'font-family': MONO,
      'padding': '48px 64px 64px',
    }}>
      <div style={{
        width: '100%',
        'max-width': '600px',
        display: 'flex',
        'flex-direction': 'column',
        gap: '24px',
      }}>
        <DesignSlider ticks={widthTicks} value={width()} onChange={setWidth} unit="px" notch={notch()} thumb={thumb()} snapRadius={snapRadius()} />
        <DesignSlider ticks={fpsTicks} value={fps()} onChange={setFps} unit="fps" notch={notch()} thumb={thumb()} snapRadius={snapRadius()} />
      </div>

      {/* Controls panel */}
      <div style={{
        display: 'flex', 'flex-direction': 'column',
        padding: '12px 16px', background: '#111', 'border-radius': '4px',
        width: '100%', 'max-width': '600px',
      }}>
        <Section title="notch animation">
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
            <CtrlSlider label="idle width"  value={notchIdleW()} min={2} max={20} onChange={setNotchIdleW} suffix="px" />
            <CtrlSlider label="idle height" value={notchIdleH()} min={2} max={24} onChange={setNotchIdleH} suffix="px" />
            <CtrlSlider label="drag height" value={notchDragH()} min={2} max={24} onChange={setNotchDragH} suffix="px" />
            <CtrlSlider label="duration"    value={notchDur()}   min={0} max={500} step={10} onChange={setNotchDur} suffix="ms" />
          </div>
          <EasingPanel
            x1={ncx1()} y1={ncy1()} x2={ncx2()} y2={ncy2()}
            onChange={(x1, y1, x2, y2) => { setNcx1(x1); setNcy1(y1); setNcx2(x2); setNcy2(y2); }}
          />
        </Section>

        <Section title="snap">
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
            <CtrlSlider label="snap radius" value={snapRadius()} min={0} max={15} step={1} onChange={setSnapRadius} suffix="%" />
          </div>
        </Section>

        <Section title="thumb slide">
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}>
            <CtrlSlider label="duration" value={thumbDur()} min={0} max={500} step={10} onChange={setThumbDur} suffix="ms" />
          </div>
          <EasingPanel
            x1={tcx1()} y1={tcy1()} x2={tcx2()} y2={tcy2()}
            onChange={(x1, y1, x2, y2) => { setTcx1(x1); setTcy1(y1); setTcx2(x2); setTcy2(y2); }}
          />
        </Section>

        {/* Copy values */}
        <button
          onClick={copyValues}
          style={{
            background: copyState() === 'ok' ? '#1a3a1a' : copyState() === 'err' ? '#3a1a1a' : ACCENT,
            color: copyState() === 'ok' ? '#5f5' : copyState() === 'err' ? '#f55' : '#fff',
            border: 'none', cursor: 'pointer',
            padding: '5px 12px', 'margin-top': '8px',
            'font-family': MONO, 'font-size': '11px',
            transition: 'background 0.2s, color 0.2s',
            'align-self': 'flex-start',
          }}
        >
          {copyState() === 'ok' ? 'copied' : copyState() === 'err' ? 'error' : 'copy values'}
        </button>
      </div>
    </div>
  );
};

export default SliderPlayground;
