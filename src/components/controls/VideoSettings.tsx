import { Component, Show, createEffect, createSignal, onMount, onCleanup } from 'solid-js';
import { ACCENT, ACCENT_75, BG, MONO } from '../../shared/tokens';
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

// Accept a dynamic totalBoxes so the exit cascade still reverses cleanly when
// the non-GIF path adds its extra control row (CRF + toggles).
const boxAnim = (open: boolean | undefined, i: number, totalBoxes: number) => {
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
// Codec-optimal CRF presets. The slider is gone — these values get applied
// automatically whenever the output format or codec changes, so the user
// always gets a "good-default" quality without thinking about it.
//   • H.264 → 23 (standard sweet spot; visually near-lossless at typical widths)
//   • H.265 → 28 (equivalent perceived quality to H.264 @ 23, smaller files)
//   • VP9 (webm) → 31 with -b:v 0 constant-quality mode
const OPTIMAL_CRF = { h264: 23, h265: 28, vp9: 31 } as const;

const H265_CAPABLE = new Set(['mp4', 'mkv']);

// Compact ON/OFF toggle used for the audio + fast-cut rows. Label on the
// left, toggle state on the right — matches the existing MONO aesthetic
// without needing a full slider track.
//
// Animations:
//   • Border + outer opacity cross-fade 180ms when the disabled state flips.
//   • Pill background + text color cross-fade 180ms on ON↔OFF.
//   • Pill text scrambles (~130ms) between "ON" and "OFF" so the state
//     change reads as a tiny rewrite, matching the scramble aesthetic used
//     on the size chip / format picker / dither menu.
//   • Brief press-scale 150ms so a click feels tactile.
// Compact ON/OFF toggle with animated state transitions:
//   • Outer border/color/opacity cross-fade 180ms when disabled-state flips.
//   • Press-scale 97% on click, springs back 150ms — tactile feedback.
//   • Pill background + text color cross-fade 180ms on ON↔OFF.
//   • "ON" and "OFF" labels are stacked and cross-fade so there's no
//     snap — label text slides through opacity rather than jumping.
//
// `on` and `disabled` are functions (not values) so Solid's JSX compiler
// reliably tracks reactive reads from the caller's appState — passing the
// bare value `on={appState.audio}` was getting captured as a one-time read
// and the pill never updated after a click.
const Toggle: Component<{
  label: string;
  hint?: string;
  on: () => boolean;
  onToggle: (v: boolean) => void;
  disabled?: () => boolean;
}> = (p) => {
  const [pressed, setPressed] = createSignal(false);
  const isOn       = () => p.on();
  const isDisabled = () => !!(p.disabled && p.disabled());

  const handleClick = () => {
    if (isDisabled()) return;
    setPressed(true);
    setTimeout(() => setPressed(false), 150);
    p.onToggle(!isOn());
  };

  return (
    <div
      onClick={handleClick}
      title={p.hint}
      style={{
        display: 'flex', 'align-items': 'center', 'justify-content': 'space-between',
        padding: '4px 8px',
        border: `1px solid ${isDisabled() ? ACCENT_75 : ACCENT}`,
        cursor: isDisabled() ? 'not-allowed' : 'pointer',
        'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
        color: isDisabled() ? ACCENT_75 : ACCENT,
        opacity: isDisabled() ? '0.55' : '1',
        'user-select': 'none',
        'box-sizing': 'border-box',
        transform: pressed() ? 'scale(0.97)' : 'scale(1)',
        transition: 'border-color 180ms ease, color 180ms ease, opacity 180ms ease, transform 150ms cubic-bezier(0.22, 1.2, 0.36, 1)',
      }}
    >
      <span>{p.label}</span>
      {/* Pill: stacked ON/OFF labels cross-fade so the text swap looks
          like a dissolve rather than a snap. Width stays fixed at 28px
          so the row doesn't shift when toggling. */}
      <span style={{
        position: 'relative',
        display: 'inline-block',
        'background-color': isOn() ? ACCENT : 'transparent',
        border: `1px solid ${ACCENT}`,
        width: '28px',
        height: '16px',
        transition: 'background-color 180ms ease',
      }}>
        <span style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'align-items': 'center', 'justify-content': 'center',
          color: BG,
          opacity: isOn() ? '1' : '0',
          transition: 'opacity 180ms ease',
        }}>ON</span>
        <span style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'align-items': 'center', 'justify-content': 'center',
          color: ACCENT,
          opacity: isOn() ? '0' : '1',
          transition: 'opacity 180ms ease',
        }}>OFF</span>
      </span>
    </div>
  );
};

// Video Settings panel — format-aware:
//   • GIF: width + fps + dither canvas.
//   • MP4/MOV/MKV: width + fps + CRF + codec (H.264/H.265) + audio + fastCut.
//   • WebM/AVI: width + fps + CRF + audio + fastCut (no codec picker).
// The canvas below keeps the current pan/zoom preview — in non-GIF mode it
// renders a live video frame at target resolution + fps (see SettingsCanvas).
const VideoSettings: Component<{
  videoEl?: HTMLVideoElement;
  open?: boolean;
  isPortrait?: boolean;
}> = (props) => {
  let panelRef!: HTMLDivElement;
  const [panelW, setPanelW] = createSignal(500);

  onMount(() => {
    const ro = new ResizeObserver(() => setPanelW(panelRef.clientWidth));
    ro.observe(panelRef);
    onCleanup(() => ro.disconnect());
  });

  const pad = () => `${Math.min(24, Math.max(10, Math.floor(panelW() * 0.06)))}px`;
  const toggleCols = () => {
    if (!supportsH265()) return panelW() < 200 ? '1fr' : '1fr 1fr';
    return panelW() < 240 ? '1fr' : panelW() < 360 ? '1fr 1fr' : '1fr 1fr 1fr';
  };

  const isGif = () => appState.outputFormat === 'gif';
  const supportsH265 = () => H265_CAPABLE.has(appState.outputFormat);
  // Fast-cut is only meaningful when we can stream-copy — same container in/out
  // and non-GIF. We still render the toggle disabled for context in other
  // cases so users understand why it's there.
  const fastCutEligible = () =>
    !isGif() && appState.inputFormat != null && appState.inputFormat === appState.outputFormat;

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

  // Keep the stored CRF aligned with the codec-optimal default whenever the
  // format or codec changes. Since the slider is gone, this is the only
  // place CRF gets set — users never see the knob, and the encoder always
  // gets a sensible value for the codec it's about to use.
  createEffect(() => {
    const fmt = appState.outputFormat;
    if (fmt === 'gif') return; // gif path doesn't read CRF
    if (fmt === 'webm')                     setAppState('crf', OPTIMAL_CRF.vp9);
    else if (supportsH265() && appState.codec === 'h265') setAppState('crf', OPTIMAL_CRF.h265);
    else                                    setAppState('crf', OPTIMAL_CRF.h264);
  });

  // Total rendered boxes (for the staggered exit): width, fps, [toggles], canvas.
  const totalBoxes = () => isGif() ? 3 : 4;

  return (
    <div ref={panelRef} style={{
      display: 'flex', 'flex-direction': 'column', gap: '12px',
      width: '100%', height: '100%',
      padding: pad(),
      'font-family': MONO, 'box-sizing': 'border-box',
    }}>
      {/* ── Width (resolution) ── */}
      <div style={{ 'flex-shrink': '0', ...boxAnim(props.open, 0, totalBoxes()) }}>
        <DesignSlider
          ticks={WIDTH_TICKS}
          value={widthValue()}
          onChange={setWidthValue}
          unit="px"
        />
      </div>

      {/* ── FPS ── */}
      <div style={{ 'flex-shrink': '0', ...boxAnim(props.open, 1, totalBoxes()) }}>
        <DesignSlider
          ticks={FPS_TICKS}
          value={appState.fps}
          onChange={(v) => setAppState('fps', v)}
          unit="fps"
        />
      </div>

      {/* ── Non-GIF: codec / audio / fast-cut toggles ── */}
      <Show when={!isGif()}>
        <div style={{
          'flex-shrink': '0',
          display: 'grid',
          'grid-template-columns': toggleCols(),
          gap: '6px',
          ...boxAnim(props.open, 2, totalBoxes()),
        }}>
          <Show when={supportsH265()}>
            <Toggle
              label="H.265"
              hint="Use H.265 (HEVC) instead of H.264 — ~30% smaller, less compatible."
              on={() => appState.codec === 'h265'}
              onToggle={(on) => setAppState('codec', on ? 'h265' : 'h264')}
            />
          </Show>
          <Toggle
            label="Audio"
            hint="Include the source audio track in the output."
            on={() => appState.audio}
            onToggle={(on) => setAppState('audio', on)}
          />
          <Toggle
            label="Fast-cut"
            hint={fastCutEligible()
              ? 'Stream-copy: near-instant, no re-encode. Cut snaps to nearest keyframe before start.'
              : `Fast-cut only works when input and output formats match (input: ${appState.inputFormat ?? '?'}).`}
            on={() => appState.fastCut && fastCutEligible()}
            onToggle={(on) => setAppState('fastCut', on)}
            disabled={() => !fastCutEligible()}
          />
        </div>
      </Show>

      {/* ── Canvas preview — dither (GIF) or scaled+fps video (non-GIF) ── */}
      <div style={{
        flex: '1 1 0',
        'min-height': '0',
        display: 'flex',
        'flex-direction': 'column',
        ...boxAnim(props.open, isGif() ? 2 : 3, totalBoxes()),
      }}>
        <SettingsCanvas videoEl={props.videoEl} isPortrait={props.isPortrait} />
      </div>
    </div>
  );
};

export default VideoSettings;
