import { Component, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import Timeline from '../controls/Timeline';

const ACCENT = '#FC006D';
const BG     = '#F8F7F6';
const MONO   = "'IBM Plex Mono', system-ui, monospace";

// Landscape: 16:9 at 560px wide  |  Portrait: 9:16 at 315px wide
const ORIENTATIONS = {
  landscape: { boxW: 560, boxH: Math.round(560 * 9 / 16) },
  portrait:  { boxW: 315, boxH: 560 },
} as const;

const fmtDuration = (s: number) => `${Math.round(s)}s`;

// Play rect corners converted to absolute path coordinates (same viewBox 79×86 as pause).
// This lets a single pair of <path> elements morph between states via CSS d-property transition.
// Play arm corners as absolute paths (converted from rect+transform, same 79×86 viewBox as pause).
const PLAY_1  = "M47.405,46.646 L26.634,26.350 L30.787,22.292 L51.558,42.588 Z";
const PLAY_2  = "M30.794,62.878 L51.565,42.582 L47.411,38.524 L26.641,58.820 Z";
// Pause bars — point order matches corresponding play arm corners for a clean morph.
const PAUSE_1 = "M27.294,62.272 L27.294,22.904 L33.099,22.904 L33.099,62.272 Z";
const PAUSE_2 = "M50.904,62.272 L50.904,22.904 L45.099,22.904 L45.099,62.272 Z";

const PlayPauseIcon: Component<{ playing: boolean; width?: number; height?: number }> = (p) => {
  let ref1!: SVGPathElement;
  let ref2!: SVGPathElement;
  let rafId = 0;
  let initialized = false;

  const nums  = (d: string) => d.match(/-?[\d.]+/g)!.map(Number);
  const build = (n: number[]) =>
    `M${n[0]},${n[1]} L${n[2]},${n[3]} L${n[4]},${n[5]} L${n[6]},${n[7]} Z`;
  const ease  = (t: number) => t < 0.5 ? 2*t*t : -1 + (4 - 2*t)*t;

  const PN1 = nums(PLAY_1),  PN2 = nums(PLAY_2);
  const AN1 = nums(PAUSE_1), AN2 = nums(PAUSE_2);

  const animateTo = (to1: number[], to2: number[]) => {
    cancelAnimationFrame(rafId);
    const f1 = nums(ref1.getAttribute('d')!);
    const f2 = nums(ref2.getAttribute('d')!);
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = ease(Math.min(1, (now - t0) / 180));
      ref1.setAttribute('d', build(f1.map((v, i) => v + (to1[i] - v) * t)));
      ref2.setAttribute('d', build(f2.map((v, i) => v + (to2[i] - v) * t)));
      if (t < 1) rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
  };

  onCleanup(() => cancelAnimationFrame(rafId));

  createEffect(() => {
    const playing = p.playing;
    if (!initialized) {
      ref1.setAttribute('d', playing ? PAUSE_1 : PLAY_1);
      ref2.setAttribute('d', playing ? PAUSE_2 : PLAY_2);
      initialized = true;
    } else {
      animateTo(playing ? AN1 : PN1, playing ? AN2 : PN2);
    }
  });

  return (
    <svg
      width={p.width ?? 16} height={p.height ?? 16}
      viewBox="0 0 79 86" fill="none" preserveAspectRatio="none"
      style={{ width: `${p.width ?? 16}px`, height: `${p.height ?? 16}px`, 'flex-shrink': '0' }}
    >
      <rect width="78.1985" height="85.1755" fill="#FC036D" />
      <path ref={ref1!} fill="white" stroke="white" stroke-width="2" />
      <path ref={ref2!} fill="white" stroke="white" stroke-width="2" />
    </svg>
  );
};

const ArrowSvg: Component<{ width?: number; height?: number }> = (p) => (
  <svg width={p.width ?? 20} height={p.height ?? 22} viewBox="0 0 79 88" fill="none"
    preserveAspectRatio="none"
    style={{ width: `${p.width ?? 20}px`, height: `${p.height ?? 22}px`, 'flex-shrink': '0' }}>
    <rect x="0" width="78.198" height="87.165" fill="#FC006D" />
    <path d="M64.984 43.583L43.739 64.796L39.49 60.553L53.481 46.582H0.009V40.582H53.481L39.49 26.613L43.739 22.37L64.984 43.583Z" fill="#FFFFFF" />
  </svg>
);

const Chip = (p: { children: any; size?: 'base' | 'xs' }) => (
  <span style={{
    display: 'inline-block', background: ACCENT, width: 'fit-content',
    'font-family': MONO,
    'font-size':   p.size === 'xs' ? '12px' : '16px',
    'line-height': p.size === 'xs' ? '16px' : '20px',
    color: BG, 'white-space': 'nowrap',
  }}>
    {p.children}
  </span>
);

const Cross = () => (
  <div style={{ position: 'relative', 'flex-shrink': '0', width: '20px', height: '20px' }}>
    <div style={{ position: 'absolute', left: '9px', top: '0', width: '2px', height: '20px', background: ACCENT }} />
    <div style={{ position: 'absolute', left: '0', top: '9px', width: '20px', height: '2px', background: ACCENT }} />
  </div>
);

const PlaygroundView: Component = () => {
  let videoRef!: HTMLVideoElement;
  let durationInputRef!: HTMLInputElement;
  let isDraggingHandle = false;
  const [dragging,     setDragging]     = createSignal(false);
  const [orientation,  setOrientation]  = createSignal<'landscape' | 'portrait'>('landscape');
  const box = () => ORIENTATIONS[orientation()];

  const [duration,    setDuration]    = createSignal(0);
  const [trimStart,   setTrimStart]   = createSignal(0);
  const [trimEnd,     setTrimEnd]     = createSignal(0);
  const [frames,      setFrames]      = createSignal<string[]>([]);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [isPlaying,     setIsPlaying]     = createSignal(false);
  const [editingDuration, setEditingDuration] = createSignal(false);
  const [draftDuration,   setDraftDuration]   = createSignal('');

  // Extract N evenly-spaced thumbnail frames from the video
  const extractFrames = (src: string, duration: number, count: number): Promise<string[]> => {
    return new Promise((resolve) => {
      const vid    = document.createElement('video');
      const canvas = document.createElement('canvas');
      const ctx    = canvas.getContext('2d')!;
      vid.src      = src;
      vid.muted    = true;
      vid.preload  = 'auto';

      const results: string[] = [];
      let idx    = 0;
      let thumbW = 24;

      const seekNext = () => {
        if (idx >= count) { resolve(results); return; }
        vid.currentTime = (idx / count) * duration + 0.01;
      };

      vid.addEventListener('seeked', () => {
        ctx.drawImage(vid, 0, 0, thumbW, 24);
        results.push(canvas.toDataURL('image/jpeg', 0.8));
        idx++;
        seekNext();
      });

      vid.addEventListener('loadedmetadata', () => {
        thumbW = Math.round(24 * vid.videoWidth / vid.videoHeight);
        canvas.width  = thumbW;
        canvas.height = 24;
        seekNext();
      });
    });
  };

  onMount(() => {
    videoRef.addEventListener('loadedmetadata', () => {
      const d = videoRef.duration;
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(d);
      extractFrames('/dev-mock.mp4', d, 20).then(setFrames);
    });

    // Track playhead + confine playback to trim region
    let rafId: number;
    const tick = () => {
      const ct  = videoRef.currentTime;
      const end = trimEnd();
      const start = trimStart();
      // Only enforce bounds when not dragging a handle — dragging seeks intentionally
      if (!isDraggingHandle && (ct >= end || ct < start)) {
        videoRef.currentTime = start;
      }
      setCurrentTime(videoRef.currentTime);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    onCleanup(() => cancelAnimationFrame(rafId));

    videoRef.addEventListener('play',  () => setIsPlaying(true));
    videoRef.addEventListener('pause', () => setIsPlaying(false));

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));

    videoRef.play().catch(() => {});
  });

  const togglePlay = () => {
    if (videoRef.paused) videoRef.play().catch(() => {});
    else videoRef.pause();
  };

  const handleTrimChange = (start: number, end: number) => {
    setTrimStart(start);
    setTrimEnd(end);
  };

  const trimmedDuration = () => trimEnd() - trimStart();

  const shakeInput = () => {
    durationInputRef.style.animation = 'none';
    void durationInputRef.offsetWidth; // force reflow so animation restarts
    durationInputRef.style.animation = 'timeline-shake 0.35s ease';
  };

  const commitDuration = () => {
    const parsed = parseFloat(draftDuration().replace(/[^0-9.]/g, ''));
    const isValid = !isNaN(parsed) && parsed >= 1 && parsed <= duration() - trimStart();
    if (isValid) {
      setTrimEnd(Math.min(trimStart() + parsed, duration()));
      setEditingDuration(false);
    } else {
      shakeInput();
      // Reset draft to nearest valid value hint
      setDraftDuration(String(Math.round(trimmedDuration())));
    }
  };

  const handleSeek = (t: number) => {
    videoRef.currentTime = Math.max(0, Math.min(t, duration()));
    setCurrentTime(videoRef.currentTime);
  };

  return (
    <>
    <style>{`
      @keyframes timeline-shake {
        0%   { transform: translateX(0); }
        15%  { transform: translateX(-5px); }
        35%  { transform: translateX(5px); }
        55%  { transform: translateX(-4px); }
        75%  { transform: translateX(3px); }
        90%  { transform: translateX(-2px); }
        100% { transform: translateX(0); }
      }
    `}</style>
    <div style={{
      position: 'fixed', inset: '0',
      background: BG,
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
    }}>
      {/* Orientation toggle */}
      <button
        onClick={() => setOrientation(o => o === 'landscape' ? 'portrait' : 'landscape')}
        style={{
          position: 'fixed', top: '16px', right: '16px',
          background: ACCENT, color: BG, border: 'none',
          'font-family': MONO, 'font-size': '11px', 'line-height': '1',
          padding: '6px 10px', cursor: 'pointer',
          'z-index': '100',
        }}
      >
        {orientation() === 'landscape' ? '↕ portrait' : '↔ landscape'}
      </button>
      <div style={{
        position: 'relative',
        width: `${box().boxW}px`,
        height: `${box().boxH}px`,
        overflow: 'hidden',
        outline: `1px solid ${ACCENT}`,
      }}>
        <video
          ref={videoRef!}
          src="/dev-mock.mp4"
          autoplay
          loop
          muted
          playsinline
          style={{ width: '100%', height: '100%', display: 'block', 'object-fit': 'cover' }}
        />

        <div style={{
          position: 'absolute', inset: '0',
          display: 'flex', 'flex-direction': 'column',
          'justify-content': 'space-between',
          padding: '24px',
          'pointer-events': 'none',
          'box-sizing': 'border-box',
        }}>
          {/* Top row */}
          <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'flex-start', width: '100%' }}>
            <div style={{ display: 'flex', 'flex-direction': 'column' }}>
              <Chip>EXPECTED SIZE</Chip>
              <Chip>27.5 MB</Chip>
            </div>
            <Cross />
            <ArrowSvg width={20} height={22} />
          </div>

          {/* Bottom: play + trimmed duration + timeline */}
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-self': 'stretch', 'pointer-events': 'auto' }}>
            {/* Chevron tracks left handle, chip tracks right handle */}
            <div style={{ position: 'relative', height: '16px', 'align-self': 'stretch' }}>
              <div
                style={{ position: 'absolute', left: `${(trimStart() / duration()) * 100}%`, height: '16px', display: 'flex', 'align-items': 'center', cursor: 'pointer', transition: !dragging() ? `left 350ms cubic-bezier(1.0,-0.35,0.22,1.15)` : 'none' }}
                onClick={togglePlay}
              >
                <PlayPauseIcon playing={isPlaying()} width={16} height={16} />
              </div>
              <div style={{ position: 'absolute', right: `${(1 - trimEnd() / duration()) * 100}%`, height: '16px', display: 'flex', 'align-items': 'center', transition: !dragging() ? `right 350ms cubic-bezier(1.0,-0.35,0.22,1.15)` : 'none' }}>
                {editingDuration() ? (
                  <input
                    ref={el => { durationInputRef = el; setTimeout(() => el.select(), 0); }}
                    type="text"
                    value={draftDuration()}
                    onInput={e => setDraftDuration(e.currentTarget.value)}
                    onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commitDuration(); } if (e.key === 'Escape') setEditingDuration(false); }}
                    onBlur={() => { setEditingDuration(false); }}
                    style={{
                      background: ACCENT, color: BG,
                      border: 'none', outline: 'none',
                      'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                      width: `${Math.max(draftDuration().length, 2) + 1}ch`,
                      padding: '0', margin: '0',
                      'caret-color': BG,
                    }}
                  />
                ) : (
                  <div
                    onClick={() => { setDraftDuration(String(Math.round(trimmedDuration()))); setEditingDuration(true); }}
                    style={{ cursor: 'text' }}
                  >
                    <Chip size="xs">{fmtDuration(trimmedDuration())}</Chip>
                  </div>
                )}
              </div>
            </div>
            <Timeline
              duration={duration()}
              trimStart={trimStart()}
              trimEnd={trimEnd()}
              currentTime={currentTime()}
              onTrimChange={handleTrimChange}
              onSeek={handleSeek}
              onHandleDragStart={() => { isDraggingHandle = true; setDragging(true); }}
              onHandleDragEnd={() => { isDraggingHandle = false; setDragging(false); }}
              frames={frames()}
              smooth={!dragging()}
            />
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default PlaygroundView;
