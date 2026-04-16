import { Component, Show, createSignal, onCleanup, onMount } from 'solid-js';
import Timeline from '../controls/Timeline';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { PlayPauseIcon, ArrowSvg, Chip, Cross } from '../../shared/ui';
import { fmtDuration, extractFrames } from '../../shared/utils';

// Landscape: 16:9 at 560px wide  |  Portrait: 9:16 at 315px wide
const ORIENTATIONS = {
  landscape: { boxW: 560, boxH: Math.round(560 * 9 / 16) },
  portrait:  { boxW: 315, boxH: 560 },
} as const;

const DropZone: Component<{ onFile: (file: File) => void }> = (p) => {
  let inputRef!: HTMLInputElement;
  const [hover, setHover] = createSignal(false);

  const load = (file: File) => {
    if (file.type.startsWith('video/')) p.onFile(file);
  };

  return (
    <div
      onClick={() => inputRef.click()}
      onDragOver={e => { e.preventDefault(); setHover(true); }}
      onDragLeave={() => setHover(false)}
      onDrop={e => { e.preventDefault(); setHover(false); const f = e.dataTransfer?.files[0]; if (f) load(f); }}
      style={{
        width: '480px', height: '270px',
        display: 'flex', 'flex-direction': 'column',
        'align-items': 'center', 'justify-content': 'center', gap: '16px',
        outline: `2px solid ${hover() ? ACCENT : '#ccc'}`,
        cursor: 'pointer',
        'font-family': MONO, 'font-size': '13px', color: hover() ? ACCENT : '#999',
        transition: 'outline-color 0.15s, color 0.15s',
        background: BG,
        'user-select': 'none',
      }}
    >
      <ArrowSvg width={28} height={30} />
      <span>drop a video or click to browse</span>
      <input ref={inputRef!} type="file" accept="video/*" style={{ display: 'none' }}
        onChange={e => { const f = e.currentTarget.files?.[0]; if (f) load(f); }} />
    </div>
  );
};

const PlaygroundView: Component = () => {
  let videoRef!: HTMLVideoElement;
  let durationInputRef!: HTMLInputElement;
  let isDraggingHandle = false;
  const [dragging,       setDragging]       = createSignal(false);
  const [orientation,    setOrientation]    = createSignal<'landscape' | 'portrait'>('landscape');
  const [videoSrc,       setVideoSrc]       = createSignal<string | null>('/dev-mock.mp4');
  const box = () => ORIENTATIONS[orientation()];

  const loadFile = (file: File) => {
    const prev = videoSrc();
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    setVideoSrc(URL.createObjectURL(file));
  };

  const [duration,    setDuration]    = createSignal(0);
  const [trimStart,   setTrimStart]   = createSignal(0);
  const [trimEnd,     setTrimEnd]     = createSignal(0);
  const [frames,      setFrames]      = createSignal<string[]>([]);
  const [currentTime, setCurrentTime] = createSignal(0);
  const [isPlaying,     setIsPlaying]     = createSignal(false);
  const [editingDuration, setEditingDuration] = createSignal(false);
  const [draftDuration,   setDraftDuration]   = createSignal('');

  onMount(() => {
    videoRef.addEventListener('loadedmetadata', () => {
      const d = videoRef.duration;
      setDuration(d);
      setTrimStart(0);
      setTrimEnd(d);
      extractFrames(videoSrc()!, d, 20).then(setFrames);
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
      {/* Video is always in the DOM so videoRef is always bound */}
      <div style={{
        position: 'relative',
        width: `${box().boxW}px`,
        height: `${box().boxH}px`,
        overflow: 'hidden',
        outline: videoSrc() ? `1px solid ${ACCENT}` : 'none',
        display: videoSrc() ? 'block' : 'none',
      }}>
        <video
          ref={videoRef!}
          src={videoSrc() ?? ''}
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

      {/* Orientation toggle — only shown when video is loaded */}
      <Show when={videoSrc()}>
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
      </Show>

      {/* Drop zone shown until a video is loaded */}
      <Show when={!videoSrc()}>
        <DropZone onFile={loadFile} />
      </Show>

    </div>
    </>
  );
};

export default PlaygroundView;
