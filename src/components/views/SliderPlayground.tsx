import { Component, createSignal, createEffect, For, Show, onCleanup } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { CtrlSlider } from '../../shared/ui';
import { solveBezier } from '../../shared/utils';

// ── Design slider (matches Paper frames) ─────────────────────────────────────

interface TickMark {
  value: number;
  label: string;
}

interface NotchParams {
  notchIdleW: number;
  notchIdleH: number;
  notchDragH: number;
  duration: number;
  easing: string;
}

interface ThumbParams {
  duration: number;
  x1: number; y1: number; x2: number; y2: number;
}

interface DesignSliderProps {
  ticks: TickMark[];
  value: number;
  onChange: (v: number) => void;
  unit: string;
  notch: NotchParams;
  thumb: ThumbParams;
  snapRadius: number; // percentage of range (0–100)
}

const TRACK_COLOR = '#001D33';
const TRACK_H = 8;
const BORDER_W = 1;

const DesignSlider: Component<DesignSliderProps & { focused?: boolean; onFocus?: () => void }> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let thumbRef: HTMLDivElement | undefined;
  let badgeRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  const [dragging, setDragging] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const [badgeW, setBadgeW] = createSignal(57);
  let measureRef: HTMLSpanElement | undefined;

  // Keep badge width in sync with text content
  createEffect(() => {
    props.value; // track value changes
    if (measureRef) setBadgeW(measureRef.offsetWidth + 8); // +8 for padding (4px each side)
  });
  let animFrame = 0;
  let snapFrame = 0;
  let hasMoved = false;
  let pointerDown = false;
  let downX = 0;
  const MOVE_THRESHOLD = 3; // px before considered a drag

  const min = () => props.ticks[0].value;
  const max = () => props.ticks[props.ticks.length - 1].value;
  const range = () => max() - min();
  const pct = () => range() <= 0 ? 0 : (props.value - min()) / range();

  const valueFromX = (clientX: number) => {
    if (!containerRef) return props.value;
    const rect = containerRef.getBoundingClientRect();
    const half = badgeW() / 2;
    const effectiveWidth = rect.width - badgeW();
    const x = clientX - rect.left - half;
    const ratio = Math.max(0, Math.min(1, effectiveWidth > 0 ? x / effectiveWidth : 0));
    return min() + ratio * range();
  };

  const animateTo = (target: number) => {
    cancelAnimationFrame(animFrame);
    const start = props.value;
    const startTime = performance.now();
    const dur = props.thumb.duration;
    const { x1, y1, x2, y2 } = props.thumb;
    const animate = (now: number) => {
      if (hasMoved) return;
      const t = Math.min((now - startTime) / dur, 1);
      const eased = solveBezier(x1, y1, x2, y2, t);
      const current = start + (target - start) * eased;
      props.onChange(current);
      if (pointerDown && !dragging() && eased >= 0.85) {
        setDragging(true);
      }
      if (t < 1) {
        animFrame = requestAnimationFrame(animate);
      }
    };
    animFrame = requestAnimationFrame(animate);
  };

  const onPointerDown = (e: PointerEvent) => {
    e.preventDefault();
    containerRef?.focus();
    cancelAnimationFrame(snapFrame);
    pointerDown = true;
    hasMoved = false;
    downX = e.clientX;
    animateTo(snapValue(valueFromX(e.clientX)));
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const snapValue = (raw: number): number => {
    const snapDist = range() * (props.snapRadius / 100);
    for (const tick of props.ticks) {
      if (Math.abs(raw - tick.value) <= snapDist) return tick.value;
    }
    return raw;
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!pointerDown) return;
    if (!hasMoved && Math.abs(e.clientX - downX) < MOVE_THRESHOLD) return;
    if (!hasMoved) {
      hasMoved = true;
      cancelAnimationFrame(animFrame);
      setDragging(true);
    }
    props.onChange(valueFromX(e.clientX));
  };

  const snapAnimateTo = (target: number) => {
    cancelAnimationFrame(snapFrame);
    const start = props.value;
    const startTime = performance.now();
    const dur = props.thumb.duration;
    const { x1, y1, x2, y2 } = props.thumb;
    const step = (now: number) => {
      const t = Math.min((now - startTime) / dur, 1);
      const eased = solveBezier(x1, y1, x2, y2, t);
      props.onChange(start + (target - start) * eased);
      if (t < 1) snapFrame = requestAnimationFrame(step);
    };
    snapFrame = requestAnimationFrame(step);
  };

  const onPointerUp = () => {
    const wasDragging = hasMoved;
    pointerDown = false;
    setDragging(false);
    hasMoved = false;
    // Only snap on release after an actual drag — clicks are already handled by onPointerDown's animateTo
    if (wasDragging) {
      const snapped = snapValue(props.value);
      if (snapped !== props.value) {
        snapAnimateTo(snapped);
      }
    }
  };

  const ARROW_STEP = () => range() / 100; // 1% per arrow press

  const onKeyDown = (e: KeyboardEvent) => {
    if (editing()) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.shiftKey ? ARROW_STEP() * 10 : ARROW_STEP();
      props.onChange(Math.min(max(), props.value + step));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      const step = e.shiftKey ? ARROW_STEP() * 10 : ARROW_STEP();
      props.onChange(Math.max(min(), props.value - step));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      startEditing();
    } else if (/^[0-9.\-]$/.test(e.key)) {
      e.preventDefault();
      startEditing(e.key);
    }
  };

  const startEditing = (initialChar?: string) => {
    if (initialChar) {
      setEditText(initialChar);
    } else {
      setEditText(String(Math.round(props.value)));
    }
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef?.focus();
      if (initialChar) {
        // Place cursor at end after the typed char
        inputRef?.setSelectionRange(initialChar.length, initialChar.length);
      } else {
        inputRef?.select();
      }
    });
  };

  const commitEdit = () => {
    const parsed = parseFloat(editText());
    if (!isNaN(parsed)) {
      const clamped = Math.max(min(), Math.min(max(), parsed));
      animateTo(clamped);
    }
    setEditing(false);
    containerRef?.focus();
  };

  const cancelEdit = () => {
    setEditing(false);
    containerRef?.focus();
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      style={{
        position: 'relative',
        height: '48px',
        'align-self': 'stretch',
        border: `${BORDER_W}px solid ${ACCENT}`,
        overflow: 'clip',
        cursor: 'pointer',
        'touch-action': 'none',
        'user-select': 'none',
        outline: 'none',
      }}
      onPointerDown={(e) => { props.onFocus?.(); onPointerDown(e); }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKeyDown}
      onFocus={() => props.onFocus?.()}
      onDblClick={(e) => { e.preventDefault(); startEditing(); }}
    >
      {/* Track background */}
      <div style={{
        position: 'absolute',
        width: '100%',
        height: `${TRACK_H}px`,
        top: '50%',
        translate: '0 -50%',
        right: '0',
        background: TRACK_COLOR,
      }} />

      {/* Track fill */}
      <div style={{
        position: 'absolute',
        width: `${pct() * 100}%`,
        height: `${TRACK_H}px`,
        left: '0',
        top: '50%',
        translate: '0 -50%',
        background: ACCENT,
      }} />

      {/* Tick labels */}
      <For each={props.ticks}>
        {(tick, i) => {
          const tickPct = () => range() <= 0 ? 0 : ((tick.value - min()) / range()) * 100;
          const isFirst = () => i() === 0;
          const isLast = () => i() === props.ticks.length - 1;
          return (
            <span style={{
              position: 'absolute',
              top: '31px',
              left: `${tickPct()}%`,
              translate: isFirst() ? '0 0' : isLast() ? '-100% 0' : '-50% 0',
              'font-family': MONO,
              'font-size': '12px',
              'line-height': '16px',
              color: TRACK_COLOR,
              'font-weight': '400',
              'white-space': 'pre',
              'pointer-events': 'none',
            }}>
              {tick.label}
            </span>
          );
        }}
      </For>

      {/* Thumb group — notch at top, badge at bottom */}
      <div ref={thumbRef} style={{
        position: 'absolute',
        left: `clamp(0px, calc(${pct() * 100}% - ${badgeW() / 2}px), calc(100% - ${badgeW()}px))`,
        top: '0',
        height: '47px',
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'space-between',
        gap: '4px',
        'pointer-events': 'none',
      }}>
        {/* Notch / thumb handle */}
        <div style={{
          width: dragging() ? `${badgeW()}px` : `${props.notch.notchIdleW}px`,
          height: dragging() ? `${props.notch.notchDragH}px` : `${props.notch.notchIdleH}px`,
          background: ACCENT,
          'flex-shrink': '0',
          transition: `width ${props.notch.duration}ms ${props.notch.easing}, height ${props.notch.duration}ms ${props.notch.easing}`,
        }} />

        {/* Value badge */}
        <div ref={badgeRef} style={{
          display: 'flex',
          'flex-direction': 'row',
          'justify-content': 'center',
          'align-items': 'end',
          padding: '4px',
          background: ACCENT,
          width: `${badgeW()}px`,
          'box-sizing': 'border-box',
          overflow: 'hidden',
          transition: 'width 80ms ease-out',
          'pointer-events': editing() ? 'auto' : 'none',
        }}>
          <Show when={editing()} fallback={
            <span ref={measureRef} style={{
              'font-family': MONO,
              'font-size': '16px',
              'line-height': '20px',
              color: BG,
              'font-weight': '400',
              'white-space': 'pre',
            }}>
              {Math.round(props.value)}{props.unit}
            </span>
          }>
            <input
              ref={inputRef}
              value={editText()}
              onInput={(e) => setEditText(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                else if (e.key === 'Escape') { e.preventDefault(); cancelEdit(); }
                e.stopPropagation();
              }}
              onBlur={commitEdit}
              style={{
                'font-family': MONO,
                'font-size': '16px',
                'line-height': '20px',
                color: BG,
                'font-weight': '400',
                background: 'transparent',
                border: 'none',
                outline: 'none',
                width: '100%',
                padding: '0',
                'text-align': 'center',
              }}
            />
          </Show>
        </div>
      </div>
    </div>
  );
};

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
