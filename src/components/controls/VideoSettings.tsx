import { Component } from 'solid-js';
import { MONO } from '../../shared/tokens';
import { appState, setAppState } from '../../state/app';
import SettingsCanvas from './SettingsCanvas';
import DesignSlider, { type TickMark } from './DesignSlider';

// Entrance animation for each settings box. The surrounding panel geometry
// now animates in sync with the bbox (see applyTr in EditorView), so the
// panel's growing/shrinking edge handles the "no overlap" visual. That lets
// us fade each box in immediately at t=0 with just a tight stagger for
// polish — no long waiting delay needed.
const ENTER_DUR = 220;  // ms — individual fade-in duration
const STAGGER   = 40;   // ms — gap between successive boxes
// Exit matches the parent bbox geometry animation (0.3s in EditorView's
// anim.dropdown.dur). If boxes fade faster than the panel shrinks, content
// pops out before the container is done moving — user reads that as the
// boxes "just disappearing" while the panel edge is still sliding.
const EXIT_DUR     = 300;  // ms — sync with parent geometry close
const EXIT_STAGGER = 30;   // ms — reverse cascade (canvas leaves first, top slider last)
const ENTER_EASE = 'cubic-bezier(0.22, 1.2, 0.36, 1)'; // slight overshoot on slide-up

// totalBoxes used to compute reverse stagger on exit so the close cascades
// out in the opposite order of the open cascade. Defaults to the known count
// (2 sliders + 1 canvas) so existing call sites don't need to pass it.
const boxAnim = (open: boolean | undefined, i: number, totalBoxes = 3) => {
  const exitIdx = totalBoxes - 1 - i;
  return {
    opacity: open ? '1' : '0',
    transform: open ? 'translateY(0)' : 'translateY(6px)',
    transition: open
      ? `opacity ${ENTER_DUR}ms ease ${i * STAGGER}ms, transform ${ENTER_DUR}ms ${ENTER_EASE} ${i * STAGGER}ms`
      : `opacity ${EXIT_DUR}ms ease ${exitIdx * EXIT_STAGGER}ms, transform ${EXIT_DUR}ms ease ${exitIdx * EXIT_STAGGER}ms`,
  };
};

// ── Tick marks (min = first, max = last — these define the slider range) ───
// Width covers the server's clamp range [240..1920]. Middle ticks land on
// common output resolutions so snap points align with typical choices.
const WIDTH_TICKS: TickMark[] = [
  { value: 240,  label: '240'  },
  { value: 640,  label: '640'  },
  { value: 1080, label: '1080' },
  { value: 1920, label: '1920' },
];
// FPS covers 1..60 with snap points at common frame rates.
const FPS_TICKS: TickMark[] = [
  { value: 1,  label: '1'  },
  { value: 12, label: '12' },
  { value: 24, label: '24' },
  { value: 30, label: '30' },
  { value: 60, label: '60' },
];

// Video Settings panel — two sliders (resolution + fps) + dither canvas.
// Fills its parent box. The canvas stretches to absorb any leftover vertical space.
const VideoSettings: Component<{
  videoEl?: HTMLVideoElement;
  open?: boolean;
  isPortrait?: boolean;
}> = (props) => {
  const isGif = () => appState.outputFormat === 'gif';

  // For GIF output, width goes to appState.width (always a concrete px value).
  // For other formats, appState.vidWidth uses 0 as a sentinel for "keep source
  // resolution". The slider can't represent 0 meaningfully (its range starts
  // at 240), so when vidWidth is 0 we display the slider pinned to max; any
  // drag then writes a concrete value and the sentinel is gone.
  const widthValue = () => {
    if (isGif()) return appState.width;
    return appState.vidWidth === 0 ? WIDTH_TICKS[WIDTH_TICKS.length - 1].value : appState.vidWidth;
  };
  const setWidthValue = (v: number) => {
    const rounded = Math.round(v);
    if (isGif()) setAppState('width', rounded);
    else         setAppState('vidWidth', rounded);
  };

  return (
    <div style={{
      display: 'flex', 'flex-direction': 'column', gap: '12px',
      width: '100%', height: '100%',
      padding: '24px',
      'font-family': MONO, 'box-sizing': 'border-box',
    }}>
      {/* ── Width (resolution) ── */}
      <div style={{ 'flex-shrink': '0', ...boxAnim(props.open, 0) }}>
        <DesignSlider
          ticks={WIDTH_TICKS}
          value={widthValue()}
          onChange={setWidthValue}
          unit="px"
        />
      </div>

      {/* ── FPS ── */}
      <div style={{ 'flex-shrink': '0', ...boxAnim(props.open, 1) }}>
        <DesignSlider
          ticks={FPS_TICKS}
          value={appState.fps}
          // Store the raw float so the thumb moves smoothly between ticks
          // (range is only 1..60 = ~8px/int, so integer-rounding felt jumpy).
          // The badge rounds for display; convert.ts rounds before sending.
          onChange={(v) => setAppState('fps', v)}
          unit="fps"
        />
      </div>

      {/* ── Canvas (dither preview) — grows to fill remaining space ── */}
      <div style={{
        flex: '1 1 0',
        'min-height': '0',
        display: 'flex',
        'flex-direction': 'column',
        ...boxAnim(props.open, 2),
      }}>
        <SettingsCanvas videoEl={props.videoEl} isPortrait={props.isPortrait} />
      </div>
    </div>
  );
};

export default VideoSettings;
