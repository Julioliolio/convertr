import { Component, For } from 'solid-js';
import { ACCENT, MONO } from '../../shared/tokens';
import { FormatButton, ArrowSvg } from '../../shared/ui';

const FORMAT_SPRING = { dur: 0.200, x1: 0.006, y1: 0.984, x2: 0.000, y2: 1.109 };

// Format dropdown (left) + PROCESS button (right) that together fill the top bar.
// The dropdown's open-state height is animated by the parent (EditorView).
const FormatPicker: Component<{
  formats: readonly string[];
  format: string;
  displayFormat: string;
  open: boolean;
  onToggleOpen: () => void;
  onSelect: (fmt: string) => void;
  onRun: () => void;
}> = (p) => (
  <>
    {/* Button row: 24px horizontal, 24px top, 0 bottom — stable position open or closed */}
    <div style={{
      display: 'flex', 'align-items': 'center', 'justify-content': 'space-between',
      'padding-inline': '24px',
      'padding-top': '24px',
      'padding-bottom': '0px',
      'box-sizing': 'border-box',
      'flex-shrink': '0',
    }}>
      <FormatButton
        format={p.displayFormat} open={p.open} onClick={p.onToggleOpen}
        spring={FORMAT_SPRING}
      />
      <div
        style={{
          cursor: 'pointer', display: 'flex', 'align-items': 'center',
          gap: '4px',
          'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
          color: ACCENT, 'user-select': 'none', 'white-space': 'nowrap',
        }}
        onClick={p.onRun}
      >
        PROCESS
        <ArrowSvg width={20} height={22} />
      </div>
    </div>
    {/* Format items — always in DOM, revealed by parent's overflow:hidden + height */}
    <div style={{
      'padding-inline': '24px',
      'padding-top': '4px',
      'padding-bottom': '0px',
      display: 'flex', 'flex-direction': 'column',
      gap: '4px',
      'pointer-events': p.open ? 'auto' : 'none',
    }}>
      <For each={p.formats.filter(f => f !== p.format)}>
        {(fmt) => (
          <div
            style={{ 'font-family': MONO, 'font-size': '16px', 'line-height': '20px', color: ACCENT, cursor: 'pointer', 'user-select': 'none' }}
            onClick={() => p.onSelect(fmt)}
          >
            {fmt}
          </div>
        )}
      </For>
    </div>
  </>
);

export default FormatPicker;
