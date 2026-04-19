import { Component, Show, createSignal } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { PlayPauseIcon, Chip } from '../../shared/ui';
import Timeline from '../controls/Timeline';
import { fmtDuration } from '../../shared/utils';

const SMOOTH_TR = 'left 350ms cubic-bezier(1.0,-0.35,0.22,1.15)';
const SMOOTH_TR_RIGHT = 'right 350ms cubic-bezier(1.0,-0.35,0.22,1.15)';

// Play/pause + duration chip + Timeline — the row pinned to the bottom of the
// video overlay. Owns its duration-edit state locally (TrimRow is the only
// reader/writer), and shakes on invalid input without surfacing a "bad
// duration" signal to the parent — callers only see `onDurationChange` fire
// with a validated value.
const TrimRow: Component<{
  duration: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  frames: string[];
  isPlaying: boolean;
  dragging: boolean;
  onTogglePlay: () => void;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
  onHandleDragStart: () => void;
  onHandleDragEnd: () => void;
  // Fired with a validated new trimmed-duration in seconds (≥ 1, ≤ remaining).
  onDurationChange: (seconds: number) => void;
}> = (p) => {
  const trimmed = () => p.trimEnd - p.trimStart;

  const [editing, setEditing] = createSignal(false);
  const [draft,   setDraft]   = createSignal('');
  let inputRef: HTMLInputElement | undefined;

  const shake = () => {
    if (!inputRef) return;
    inputRef.style.animation = 'none';
    void inputRef.offsetWidth;
    inputRef.style.animation = 'timeline-shake 0.35s ease';
  };

  const startEdit = () => {
    setDraft(String(Math.round(trimmed())));
    setEditing(true);
  };

  const commit = () => {
    const parsed = parseFloat(draft().replace(/[^0-9.]/g, ''));
    const valid = !isNaN(parsed) && parsed >= 1 && parsed <= p.duration - p.trimStart;
    if (valid) {
      p.onDurationChange(parsed);
      setEditing(false);
    } else {
      shake();
      setDraft(String(Math.round(trimmed())));
    }
  };

  const cancel = () => setEditing(false);

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-self': 'stretch', 'pointer-events': 'auto' }}>
      <div style={{ position: 'relative', height: '16px', 'align-self': 'stretch' }}>
        {/* Play/pause — tracks left trim handle */}
        <div
          title={p.isPlaying ? 'Pause' : 'Play'}
          style={{
            position: 'absolute',
            left: `${(p.trimStart / (p.duration || 1)) * 100}%`,
            height: '16px', display: 'flex', 'align-items': 'center',
            cursor: 'pointer',
            transition: !p.dragging ? SMOOTH_TR : 'none',
          }}
          onClick={p.onTogglePlay}
        >
          <PlayPauseIcon playing={p.isPlaying} width={16} height={16} />
        </div>
        {/* Duration chip — tracks right trim handle */}
        <div style={{
          position: 'absolute',
          right: `${(1 - p.trimEnd / (p.duration || 1)) * 100}%`,
          height: '16px', display: 'flex', 'align-items': 'center',
          transition: !p.dragging ? SMOOTH_TR_RIGHT : 'none',
        }}>
          <Show
            when={editing()}
            fallback={
              <div title="Edit duration" onClick={startEdit} style={{ cursor: 'text' }}>
                <Chip size="xs">{fmtDuration(trimmed())}</Chip>
              </div>
            }
          >
            <input
              ref={el => { inputRef = el; setTimeout(() => el.select(), 0); }}
              type="text"
              value={draft()}
              onInput={e => setDraft(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); commit(); }
                if (e.key === 'Escape') cancel();
              }}
              onBlur={cancel}
              style={{
                background: ACCENT, color: BG, border: 'none', outline: 'none',
                'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                width: `${Math.max(draft().length, 2) + 1}ch`,
                padding: '0', margin: '0', 'caret-color': BG,
              }}
            />
          </Show>
        </div>
      </div>
      <Timeline
        duration={p.duration}
        trimStart={p.trimStart}
        trimEnd={p.trimEnd}
        currentTime={p.currentTime}
        onTrimChange={p.onTrimChange}
        onSeek={p.onSeek}
        onHandleDragStart={p.onHandleDragStart}
        onHandleDragEnd={p.onHandleDragEnd}
        frames={p.frames}
        smooth={!p.dragging}
      />
    </div>
  );
};

export default TrimRow;
