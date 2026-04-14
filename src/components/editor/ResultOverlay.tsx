import { Component, Show } from 'solid-js';
import { appState } from '../../state/app';
import { ACCENT, BG, MONO } from '../../shared/tokens';

// Full-screen result overlay shown after conversion completes.
// Renders a video for non-GIF outputs and an image for GIF.
const ResultOverlay: Component<{
  url: string;
  filename: string | null;
  onClose: () => void;
}> = (p) => (
  <div style={{
    position: 'fixed', inset: '0',
    background: BG,
    display: 'flex', 'flex-direction': 'column',
    'align-items': 'center', 'justify-content': 'center',
    gap: '16px',
    'z-index': '100',
  }}>
    <Show
      when={appState.outputFormat === 'gif'}
      fallback={
        <video src={p.url} controls
          style={{ 'max-width': '80%', 'max-height': '60vh', display: 'block' }} />
      }
    >
      <img src={p.url} alt="Result"
        style={{ 'max-width': '80%', 'max-height': '60vh', display: 'block' }} />
    </Show>
    <div style={{ display: 'flex', gap: '8px' }}>
      <a href={`/download/${appState.currentJobId}`}
         download={p.filename || 'output'}
         style={{ 'text-decoration': 'none' }}>
        <div style={{
          background: ACCENT, color: BG,
          'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
          padding: '8px 16px', cursor: 'pointer',
        }}>DOWNLOAD</div>
      </a>
      <div
        style={{
          background: 'transparent', color: ACCENT, border: `1px solid ${ACCENT}`,
          'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
          padding: '8px 16px', cursor: 'pointer', 'box-sizing': 'border-box',
        }}
        onClick={p.onClose}
      >CLOSE</div>
    </div>
  </div>
);

export default ResultOverlay;
