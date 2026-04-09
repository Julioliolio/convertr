import { Component, For, createSignal, onMount, onCleanup } from 'solid-js';
import { ACCENT } from '../../shared/tokens';

const TRIM_HANDLE_TICK = '#F2F4F9';

const CROSS_GAP     = 24; // px gap between cross and trim handle (default, unclamped)
const CROSS_W       = 20; // px width of the cross icon
const CROSS_HIDE_PX = CROSS_W + 12; // hide cross when handle is within 12px of it

// Matches the bounding-box easing used in EditorView
const BBOX_EASE = 'cubic-bezier(1.0,-0.35,0.22,1.15)';
const BBOX_DUR  = '350ms';
const POS_TR    = (on: boolean) => on ? `left ${BBOX_DUR} ${BBOX_EASE}, width ${BBOX_DUR} ${BBOX_EASE}, clip-path ${BBOX_DUR} ${BBOX_EASE}` : 'none';

const TimelineCross: Component<{ visible: boolean }> = (p) => (
  <div style={{
    position: 'relative', width: `${CROSS_W}px`, height: `${CROSS_W}px`, 'flex-shrink': '0',
    transform: p.visible ? 'rotate(0deg)' : 'rotate(45deg)',
    transition: p.visible
      ? `transform 320ms ${BBOX_EASE} 0ms`
      : `transform 180ms ease 0ms`,
  }}>
    {/* Horizontal bar — first in, last out; overshoots from center */}
    <div style={{
      position: 'absolute', left: '0', top: '9px', width: `${CROSS_W}px`, height: '2px', background: ACCENT,
      transform: p.visible ? 'scaleX(1)' : 'scaleX(0)',
      'transform-origin': 'center center',
      transition: p.visible
        ? `transform 280ms ${BBOX_EASE} 0ms`
        : `transform 120ms ease 60ms`,
    }} />
    {/* Vertical bar — second in, first out; overshoots from center */}
    <div style={{
      position: 'absolute', left: '9px', top: '0', width: '2px', height: `${CROSS_W}px`, background: ACCENT,
      transform: p.visible ? 'scaleY(1)' : 'scaleY(0)',
      'transform-origin': 'center center',
      transition: p.visible
        ? `transform 280ms ${BBOX_EASE} 50ms`
        : `transform 120ms ease 0ms`,
    }} />
  </div>
);

export interface TimelineProps {
  duration: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (time: number) => void;
  onHandleDragStart?: () => void;
  onHandleDragEnd?: () => void;
  frames?: string[];
  smooth?: boolean;
}

const Timeline: Component<TimelineProps> = (props) => {
  let trackRef!: HTMLDivElement;
  const [trackWidth, setTrackWidth] = createSignal(0);

  onMount(() => {
    if (!trackRef) return;
    setTrackWidth(trackRef.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setTrackWidth(entry.contentRect.width);
    });
    observer.observe(trackRef);
    onCleanup(() => observer.disconnect());
  });

  const leftPct  = () => `${(props.trimStart / props.duration) * 100}%`;
  const headLeft = () => `${(props.currentTime / props.duration) * 100}%`;

  const trimStartPx    = () => (props.trimStart / props.duration) * trackWidth();
  const trimEndPx      = () => (props.trimEnd   / props.duration) * trackWidth();
  const showLeftCross  = () => trimStartPx() >= CROSS_HIDE_PX;
  const showRightCross = () => trackWidth() - trimEndPx() >= CROSS_HIDE_PX;

  // Clicking / dragging anywhere on the track scrubs the playhead
  const onTrackMouseDown = (e: MouseEvent) => {
    e.preventDefault();
    const rect = trackRef.getBoundingClientRect();
    const seek = (ev: MouseEvent) => {
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      props.onSeek(ratio * props.duration);
    };
    seek(e);
    const onUp = () => {
      document.removeEventListener('mousemove', seek);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', seek);
    document.addEventListener('mouseup', onUp);
    onCleanup(() => {
      document.removeEventListener('mousemove', seek);
      document.removeEventListener('mouseup', onUp);
    });
  };

  const dragHandle = (which: 'start' | 'end') => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onHandleDragStart?.();
    const rect = trackRef.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const t = ratio * props.duration;
      if (which === 'start') {
        const clamped = Math.min(t, props.trimEnd - 1);
        props.onTrimChange(clamped, props.trimEnd);
        props.onSeek(clamped);
      } else {
        const clamped = Math.max(t, props.trimStart + 1);
        props.onTrimChange(props.trimStart, clamped);
        props.onSeek(clamped);
      }
    };
    const onUp = () => {
      props.onHandleDragEnd?.();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    onCleanup(() => {
      props.onHandleDragEnd?.();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    });
  };

  // Drag the whole trim window (pan), preserving clip duration
  const dragPan = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    props.onHandleDragStart?.();
    const rect = trackRef.getBoundingClientRect();
    const startX       = e.clientX;
    const startTrimStart = props.trimStart;
    const startTrimEnd   = props.trimEnd;
    const clipDuration   = startTrimEnd - startTrimStart;

    const onMove = (ev: MouseEvent) => {
      const dt = ((ev.clientX - startX) / rect.width) * props.duration;
      let newStart = startTrimStart + dt;
      let newEnd   = startTrimEnd   + dt;
      if (newStart < 0)              { newStart = 0;               newEnd = clipDuration; }
      if (newEnd > props.duration)   { newEnd = props.duration;    newStart = props.duration - clipDuration; }
      props.onTrimChange(newStart, newEnd);
      props.onSeek(newStart);
    };
    const onUp = () => {
      props.onHandleDragEnd?.();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    onCleanup(() => {
      props.onHandleDragEnd?.();
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    });
  };

  return (
    <div style={{ display: 'flex', 'align-items': 'center', 'align-self': 'stretch', height: '24px', 'flex-shrink': '0' }}>
      <div
        ref={trackRef!}
        style={{
          height: '24px', flex: '1', position: 'relative',
          background: 'transparent',
          overflow: 'hidden',
          cursor: 'col-resize',
        }}
        onMouseDown={onTrackMouseDown}
      >
        {/* Crosses — first in DOM so every subsequent element paints over them */}
        <div style={{
          position: 'absolute',
          left: `max(0px, calc(${(props.trimStart / props.duration) * 100}% - ${CROSS_GAP + CROSS_W}px))`,
          top: '0', bottom: '0',
          display: 'flex', 'align-items': 'center',
          'pointer-events': 'none',
          transition: POS_TR(!!props.smooth),
        }}>
          <TimelineCross visible={showLeftCross()} />
        </div>

        <div style={{
          position: 'absolute',
          left: `min(calc(100% - ${CROSS_W}px), calc(${(props.trimEnd / props.duration) * 100}% + ${CROSS_GAP}px))`,
          top: '0', bottom: '0',
          display: 'flex', 'align-items': 'center',
          'pointer-events': 'none',
          transition: POS_TR(!!props.smooth),
        }}>
          <TimelineCross visible={showRightCross()} />
        </div>

        {/* Frame thumbnails — clipped to trim region only, transparent outside */}
        <div style={{
          position: 'absolute', inset: '0', display: 'flex', 'pointer-events': 'none',
          'clip-path': `inset(0 ${100 - (props.trimEnd / props.duration) * 100}% 0 ${(props.trimStart / props.duration) * 100}%)`,
          transition: POS_TR(!!props.smooth),
        }}>
          <For each={props.frames ?? []}>
            {(src) => (
              <img
                src={src}
                style={{ flex: '1', 'min-width': '0', height: '100%', 'object-fit': 'cover', display: 'block' }}
              />
            )}
          </For>
        </div>

        {/* Playhead — clipped to trim region so it never escapes outside */}
        <div style={{
          position: 'absolute',
          left: `${(props.trimStart / props.duration) * 100}%`,
          width: `${((props.trimEnd - props.trimStart) / props.duration) * 100}%`,
          top: '0', height: '100%',
          overflow: 'hidden',
          'pointer-events': 'none',
          'z-index': '4',
          transition: POS_TR(!!props.smooth),
        }}>
          <div
            style={{
              position: 'absolute',
              left: `${((props.currentTime - props.trimStart) / (props.trimEnd - props.trimStart)) * 100}%`,
              top: '0', height: '100%',
              width: '12px',
              transform: 'translateX(-50%)',
              cursor: 'col-resize',
              display: 'flex',
              'justify-content': 'center',
              'pointer-events': 'auto',
            }}
            onMouseDown={(e) => { e.stopPropagation(); onTrackMouseDown(e); }}
          >
            <div style={{ width: '1px', height: '100%', background: ACCENT, 'pointer-events': 'none' }} />
          </div>
        </div>

        {/* Left trim handle — 22px hit area extends rightward into the selection */}
        <div
          style={{ position: 'absolute', left: leftPct(), top: '0', width: '22px', height: '100%', cursor: 'ew-resize', 'z-index': '5', transition: POS_TR(!!props.smooth) }}
          onMouseDown={dragHandle('start')}
        >
          <div style={{ position: 'absolute', left: '0', top: '0', width: '6px', height: '100%', background: ACCENT }} />
          <div style={{ position: 'absolute', left: '2px', top: '7px', width: '2px', height: '10px', background: TRIM_HANDLE_TICK, 'pointer-events': 'none' }} />
        </div>

        {/* Right trim handle — 22px hit area extends leftward into the selection */}
        <div
          style={{ position: 'absolute', left: `calc(${(props.trimEnd / props.duration) * 100}% - 22px)`, top: '0', width: '22px', height: '100%', cursor: 'ew-resize', 'z-index': '5', transition: POS_TR(!!props.smooth) }}
          onMouseDown={dragHandle('end')}
        >
          <div style={{ position: 'absolute', right: '0', top: '0', width: '6px', height: '100%', background: ACCENT }} />
          <div style={{ position: 'absolute', right: '2px', top: '7px', width: '2px', height: '10px', background: TRIM_HANDLE_TICK, 'pointer-events': 'none' }} />
        </div>

        {/* Trim region border — only outlines the active selection */}
        <div style={{
          position: 'absolute',
          top: '0', height: '100%',
          left: `${(props.trimStart / props.duration) * 100}%`,
          width: `${((props.trimEnd - props.trimStart) / props.duration) * 100}%`,
          border: `1px solid ${ACCENT}`,
          'pointer-events': 'none',
          'z-index': '6',
          'box-sizing': 'border-box',
          transition: POS_TR(!!props.smooth),
        }} />

        {/* Pan zones — span from cross to handle (cross + gap) */}
        <div style={{
          position: 'absolute',
          left: `calc(${(props.trimStart / props.duration) * 100}% - ${CROSS_GAP + CROSS_W}px)`,
          width: `${CROSS_GAP + CROSS_W}px`,
          top: '0', height: '100%',
          cursor: 'grab',
          'z-index': '3',
          'pointer-events': showLeftCross() ? 'auto' : 'none',
          transition: POS_TR(!!props.smooth),
        }}
        onMouseDown={dragPan}
        />

        <div style={{
          position: 'absolute',
          left: `${(props.trimEnd / props.duration) * 100}%`,
          width: `${CROSS_GAP + CROSS_W}px`,
          top: '0', height: '100%',
          cursor: 'grab',
          'z-index': '3',
          'pointer-events': showRightCross() ? 'auto' : 'none',
          transition: POS_TR(!!props.smooth),
        }}
        onMouseDown={dragPan}
        />
      </div>
    </div>
  );
};

export default Timeline;
