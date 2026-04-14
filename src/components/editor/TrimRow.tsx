import { Component, Show } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { PlayPauseIcon, Chip } from '../../shared/ui';
import Timeline from '../controls/Timeline';
import { fmtDuration } from '../../shared/utils';

const SMOOTH_TR = 'left 350ms cubic-bezier(1.0,-0.35,0.22,1.15)';
const SMOOTH_TR_RIGHT = 'right 350ms cubic-bezier(1.0,-0.35,0.22,1.15)';

// Play/pause + duration chip + Timeline — the row pinned to the bottom of the
// video overlay. Handles its own shake animation on invalid duration input.
const TrimRow: Component<{
  duration: number;
  trimStart: number;
  trimEnd: number;
  currentTime: number;
  frames: string[];
  isPlaying: boolean;
  dragging: boolean;
  editingDuration: boolean;
  draftDuration: string;
  onTogglePlay: () => void;
  onTrimChange: (start: number, end: number) => void;
  onSeek: (t: number) => void;
  onHandleDragStart: () => void;
  onHandleDragEnd: () => void;
  onStartEditDuration: () => void;
  onDraftDurationInput: (v: string) => void;
  onCommitDuration: () => void;
  onCancelEditDuration: () => void;
  setDurationInputRef: (el: HTMLInputElement) => void;
}> = (p) => {
  const trimmed = () => p.trimEnd - p.trimStart;

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '4px', 'align-self': 'stretch', 'pointer-events': 'auto' }}>
      <div style={{ position: 'relative', height: '16px', 'align-self': 'stretch' }}>
        {/* Play/pause — tracks left trim handle */}
        <div
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
            when={p.editingDuration}
            fallback={
              <div onClick={p.onStartEditDuration} style={{ cursor: 'text' }}>
                <Chip size="xs">{fmtDuration(trimmed())}</Chip>
              </div>
            }
          >
            <input
              ref={el => { p.setDurationInputRef(el); setTimeout(() => el.select(), 0); }}
              type="text"
              value={p.draftDuration}
              onInput={e => p.onDraftDurationInput(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  { e.preventDefault(); p.onCommitDuration(); }
                if (e.key === 'Escape') p.onCancelEditDuration();
              }}
              onBlur={p.onCancelEditDuration}
              style={{
                background: ACCENT, color: BG, border: 'none', outline: 'none',
                'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                width: `${Math.max(p.draftDuration.length, 2) + 1}ch`,
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
