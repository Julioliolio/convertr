import { Component } from 'solid-js';
import { appState } from '../../state/app';
import { ACCENT, BG, MONO } from '../../shared/tokens';
import LoadingOverlay from '../LoadingOverlay';

// Full-screen overlay shown while the server is running the conversion job.
// Reads progress directly from appState so we don't have to wire extra props.
const ConvertingOverlay: Component = () => (
  <div style={{
    position: 'fixed', inset: '0',
    overflow: 'hidden',
    'z-index': '100',
  }}>
    <LoadingOverlay />
    <div style={{
      position: 'absolute', inset: '0',
      display: 'flex', 'flex-direction': 'column',
      'align-items': 'center', 'justify-content': 'center',
      gap: '12px',
      'font-family': MONO,
      'pointer-events': 'none',
    }}>
      <span style={{ background: BG, padding: '2px 6px', color: ACCENT, 'font-size': '12px', 'line-height': '16px' }}>
        {appState.progressMsg || 'Converting...'}
      </span>
      <div style={{ width: '200px', height: '2px', background: 'rgba(252,0,109,0.2)', 'border-radius': '1px' }}>
        <div style={{
          width: `${appState.progress}%`, height: '100%',
          background: ACCENT, transition: 'width 0.3s', 'border-radius': '1px',
        }} />
      </div>
      <span style={{ background: BG, padding: '2px 6px', color: ACCENT, 'font-size': '12px', 'line-height': '16px' }}>
        {Math.round(appState.progress)}%
      </span>
    </div>
  </div>
);

export default ConvertingOverlay;
