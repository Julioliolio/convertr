import { Component, For } from 'solid-js';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import { FormatButton, buttonProps } from '../../shared/ui';

// Box-with-up-arrow glyph for PROCESS. currentColor inherits from text so the
// icon follows ACCENT; the inner slot stays white to read as a cutout.
// Rendered 20×20 (square) so the box is a little wider than before while
// still matching the text line-height (20px). viewBox is centered on the
// arrow center (x≈27.6) so widening the box doesn't shift the arrow.
const ProcessIcon: Component<{ width?: number; height?: number }> = (p) => (
  <svg
    width={p.width ?? 20}
    height={p.height ?? 20}
    viewBox="-4.14 9.77 63.48 63.48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    style={{ overflow: 'visible', 'flex-shrink': 0 }}
  >
    <rect x="-4.14" y="9.77" width="63.48" height="63.48" fill="currentColor" />
    <path class="process-arrow" d="M27.76 -20.72L45.29 -2.64L41.68 0.87L30.13 -11.04L29.48 33.81L24.44 33.73L25.10 -11.11L13.21 0.45L9.71 -3.17Z" fill="currentColor" />
    <rect x="24.83" y="10.11" width="4.77" height="26.69" fill="white" />
  </svg>
);

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
    <style>{`
      @keyframes process-arrow-bounce {
        0%, 60%, 100% { transform: translateY(0); }
        25%           { transform: translateY(-6px); }
      }
      .process-chip:hover .process-arrow {
        animation: process-arrow-bounce 1s cubic-bezier(0.22, 1.15, 0.5, 1) infinite;
        transform-box: fill-box;
        transform-origin: center;
      }
      /* Pink highlight behind just the text — hugs the line-height like the
         EXPECTED SIZE chip. Grows rightward on hover so the icon's box reads
         as "extending" into the highlight. */
      .process-text-wrap {
        position: relative;
        display: inline-block;
        line-height: 20px;
        padding-left: 4px;
        padding-right: 2px;
      }
      .process-bg {
        position: absolute;
        top: 0; bottom: 0; right: 0; left: -1px;
        background: ${ACCENT};
        clip-path: inset(0 100% 0 0);
        transition: clip-path 250ms cubic-bezier(0.22, 1.0, 0.36, 1);
        pointer-events: none;
        z-index: 0;
      }
      .process-chip:hover .process-bg {
        clip-path: inset(0 0 0 0);
      }
      .process-text {
        position: relative;
        z-index: 1;
        transition: color 200ms ease;
      }
      .process-chip:hover .process-text {
        color: ${BG};
      }
    `}</style>
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
        title="Output format"
      />
      <div
        class="process-chip"
        style={{
          position: 'relative', 'z-index': '2',
          cursor: 'pointer', display: 'flex', 'align-items': 'center',
          gap: '0',
          'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
          color: ACCENT, 'user-select': 'none', 'white-space': 'nowrap',
        }}
        {...buttonProps(p.onRun, 'Process')}
      >
        <div style={{ display: 'flex', 'align-items': 'center' }}>
          <ProcessIcon />
        </div>
        <span class="process-text-wrap">
          <span class="process-bg" />
          <span class="process-text">PROCESS</span>
        </span>
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
            {...buttonProps(() => p.onSelect(fmt), `Select ${fmt}`)}
          >
            {fmt}
          </div>
        )}
      </For>
    </div>
  </>
);

export default FormatPicker;
