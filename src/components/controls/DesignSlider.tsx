import { Component, createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { solveBezier } from '../../shared/utils';

export interface TickMark {
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

const DEFAULT_NOTCH: NotchParams = {
  notchIdleW: 6, notchIdleH: 12, notchDragH: 6, duration: 150,
  easing: 'cubic-bezier(0.330, 0.595, 0.599, 1.170)',
};
const DEFAULT_THUMB: ThumbParams = {
  duration: 250, x1: 0.631, y1: 0.013, x2: 0, y2: 0.993,
};
const DEFAULT_SNAP_RADIUS = 5; // % of range

interface DesignSliderProps {
  ticks: TickMark[];
  value: number;
  onChange: (v: number) => void;
  unit: string;
  notch?: NotchParams;
  thumb?: ThumbParams;
  snapRadius?: number;                 // % of range (0..100)
  displayValue?: (v: number) => string; // override badge text (e.g. "orig")
  onFocus?: () => void;
}

const TRACK_COLOR = '#001D33';
const TRACK_H = 8;
const BORDER_W = 1;

const DesignSlider: Component<DesignSliderProps> = (props) => {
  let containerRef: HTMLDivElement | undefined;
  let inputRef: HTMLInputElement | undefined;
  let measureRef: HTMLSpanElement | undefined;

  const [dragging, setDragging] = createSignal(false);
  const [editing, setEditing]   = createSignal(false);
  const [editText, setEditText] = createSignal('');
  const [badgeW, setBadgeW]     = createSignal(57);

  let animFrame = 0;
  let snapFrame = 0;
  let hasMoved = false;
  let pointerDown = false;
  let downX = 0;
  const MOVE_THRESHOLD = 3;

  const notch      = () => props.notch      ?? DEFAULT_NOTCH;
  const thumb      = () => props.thumb      ?? DEFAULT_THUMB;
  const snapRadius = () => props.snapRadius ?? DEFAULT_SNAP_RADIUS;

  const min   = () => props.ticks[0].value;
  const max   = () => props.ticks[props.ticks.length - 1].value;
  const range = () => max() - min();
  const pct   = () => range() <= 0 ? 0 : (props.value - min()) / range();

  // Memoized so sub-integer float changes to props.value (e.g. while dragging
  // fps) don't re-trigger the layout-reading effect below. The measured text
  // only changes when the rounded display value changes.
  const badgeText = createMemo(() => props.displayValue
    ? props.displayValue(props.value)
    : `${Math.round(props.value)}${props.unit}`);

  // Keep badge width in sync with its text content (+8 for 4px padding each side)
  createEffect(() => {
    badgeText(); // track
    if (measureRef) setBadgeW(measureRef.offsetWidth + 8);
  });

  const valueFromX = (clientX: number) => {
    if (!containerRef) return props.value;
    const rect = containerRef.getBoundingClientRect();
    const half = badgeW() / 2;
    const effectiveWidth = rect.width - badgeW();
    const x = clientX - rect.left - half;
    const ratio = Math.max(0, Math.min(1, effectiveWidth > 0 ? x / effectiveWidth : 0));
    return min() + ratio * range();
  };

  const snapValue = (raw: number): number => {
    const snapDist = range() * (snapRadius() / 100);
    for (const tick of props.ticks) {
      if (Math.abs(raw - tick.value) <= snapDist) return tick.value;
    }
    return raw;
  };

  const animateTo = (target: number) => {
    cancelAnimationFrame(animFrame);
    const start = props.value;
    const startTime = performance.now();
    const { duration: dur, x1, y1, x2, y2 } = thumb();
    const step = (now: number) => {
      if (hasMoved) return;
      const t = Math.min((now - startTime) / dur, 1);
      const eased = solveBezier(x1, y1, x2, y2, t);
      props.onChange(start + (target - start) * eased);
      if (pointerDown && !dragging() && eased >= 0.85) setDragging(true);
      if (t < 1) animFrame = requestAnimationFrame(step);
    };
    animFrame = requestAnimationFrame(step);
  };

  const snapAnimateTo = (target: number) => {
    cancelAnimationFrame(snapFrame);
    const start = props.value;
    const startTime = performance.now();
    const { duration: dur, x1, y1, x2, y2 } = thumb();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / dur, 1);
      const eased = solveBezier(x1, y1, x2, y2, t);
      props.onChange(start + (target - start) * eased);
      if (t < 1) snapFrame = requestAnimationFrame(step);
    };
    snapFrame = requestAnimationFrame(step);
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

  const onPointerUp = () => {
    const wasDragging = hasMoved;
    pointerDown = false;
    setDragging(false);
    hasMoved = false;
    // Only snap on release after an actual drag — clicks are already snapped by onPointerDown.
    if (wasDragging) {
      const snapped = snapValue(props.value);
      if (snapped !== props.value) snapAnimateTo(snapped);
    }
  };

  const ARROW_STEP = () => range() / 100; // 1% per arrow press

  const startEditing = (initialChar?: string) => {
    setEditText(initialChar ?? String(Math.round(props.value)));
    setEditing(true);
    requestAnimationFrame(() => {
      inputRef?.focus();
      if (initialChar) inputRef?.setSelectionRange(initialChar.length, initialChar.length);
      else inputRef?.select();
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
        'box-sizing': 'border-box',
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
          const isLast  = () => i() === props.ticks.length - 1;
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

      {/* Thumb group — notch on top, badge on bottom */}
      <div style={{
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
          width: dragging() ? `${badgeW()}px` : `${notch().notchIdleW}px`,
          height: dragging() ? `${notch().notchDragH}px` : `${notch().notchIdleH}px`,
          background: ACCENT,
          'flex-shrink': '0',
          transition: `width ${notch().duration}ms ${notch().easing}, height ${notch().duration}ms ${notch().easing}`,
        }} />

        {/* Value badge */}
        <div style={{
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
              {badgeText()}
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

export default DesignSlider;
