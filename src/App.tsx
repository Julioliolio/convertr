import { Component, Show, createSignal } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';
import { ACCENT, BG, MONO } from './shared/tokens';

export interface VideoInfo {
  file?: File;
  url?: string;
  name: string;
  sizeBytes: number;
  width: number;
  height: number;
  objectUrl: string;
}

const App: Component = () => {
  const [view, setView]   = createSignal<'idle' | 'editor'>('idle');
  const [video, setVideo] = createSignal<VideoInfo | null>(null);

  const handleVideoSelected = (info: VideoInfo) => {
    setVideo(info);
    setView('editor');
  };

  const handleBack = () => {
    const v = video();
    if (v?.objectUrl) URL.revokeObjectURL(v.objectUrl);
    setVideo(null);
    setView('idle');
  };

  return (
    <>
      <Show
        when={view() === 'editor' && video()}
        fallback={<IdleView onVideoSelected={handleVideoSelected} />}
      >
        {(v) => <EditorView video={v()} onBack={handleBack} />}
      </Show>
      {__WEB__ && (
        <Show when={view() === 'idle'}>
          <WebFooter />
        </Show>
      )}
    </>
  );
};

// Web build only: say what this page is and point at the full app. Sits in
// the band below IdleView's bottom guide (SPLASH.GB = 92.4%), right-aligned
// with its right guide (97.2%). The download page is one level up on Pages.
const WebFooter: Component = () => (
  <div style={{
    position: 'fixed', right: '2.8%', bottom: '0', height: '7.6%',
    display: 'flex', 'align-items': 'center', gap: '8px',
    'font-family': MONO, 'font-size': '11px', 'line-height': '16px',
    color: ACCENT, 'white-space': 'nowrap', 'z-index': '10',
  }}>
    <span style={{ opacity: '0.6' }}>RUNS IN YOUR BROWSER</span>
    <a href="../" style={{ color: BG, background: ACCENT, padding: '0 4px', 'text-decoration': 'none' }}>
      GET THE DESKTOP APP ↗
    </a>
  </div>
);

export default App;
