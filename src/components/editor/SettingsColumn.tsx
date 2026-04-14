import { Component } from 'solid-js';
import { ACCENT, MONO } from '../../shared/tokens';
import ControlPanel from '../layout/ControlPanel';

// VIDEO SETTINGS label + ControlPanel (sliders + RUN button) for the settings
// column. The parent positions/animates this via the forwarded ref.
const SettingsColumn: Component<{
  ref: (el: HTMLDivElement) => void;
  onRun: () => void;
}> = (p) => (
  <div
    ref={p.ref}
    style={{ position: 'absolute', '-webkit-app-region': 'no-drag', 'min-width': '200px' } as any}
  >
    <span style={{
      'font-family': MONO, 'font-size': '16px', 'line-height': '20px',
      color: ACCENT, 'white-space': 'nowrap', display: 'block', 'margin-bottom': '12px',
    }}>
      VIDEO SETTINGS
    </span>
    <ControlPanel onRun={p.onRun} />
  </div>
);

export default SettingsColumn;
