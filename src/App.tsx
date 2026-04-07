import { Component, createSignal, Show } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';
import PlaygroundView from './components/views/PlaygroundView';

export interface VideoInfo {
  file?: File;
  url?: string;
  name: string;
  sizeBytes: number;
  width: number;
  height: number;
  objectUrl: string;
}

const IS_DEV = import.meta.env.DEV;

// ── Dev tab bar ───────────────────────────────────────────────────────────────
type DevTab = 'app' | 'playground';

const DevBar: Component<{ active: DevTab; onChange: (t: DevTab) => void }> = (p) => {
  const tabs: { id: DevTab; label: string }[] = [
    { id: 'app',        label: 'app' },
    { id: 'playground', label: 'playground' },
  ];
  return (
    <div style={{
      position: 'fixed', bottom: '0', left: '0', right: '0',
      display: 'flex', 'align-items': 'center', gap: '1px',
      background: '#111', 'z-index': '9999',
      'font-family': "'IBM Plex Mono', monospace",
      'font-size': '11px',
      'border-top': '1px solid #333',
    }}>
      <span style={{ color: '#555', padding: '4px 8px', 'flex-shrink': '0' }}>dev</span>
      {tabs.map(t => (
        <button
          onClick={() => p.onChange(t.id)}
          style={{
            background: p.active === t.id ? '#FC006D' : 'transparent',
            color:      p.active === t.id ? '#fff'    : '#666',
            border: 'none', cursor: 'pointer',
            padding: '4px 10px',
            'font-family': 'inherit', 'font-size': 'inherit',
            transition: 'background 0.15s, color 0.15s',
          }}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
};

const App: Component = () => {
  const [devTab, setDevTab] = createSignal<DevTab>('playground');
  const [view, setView] = createSignal<'idle' | 'editor'>('idle');
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
      <Show when={devTab() === 'playground'}>
        <PlaygroundView />
      </Show>
      <Show when={!IS_DEV || devTab() === 'app'}>
        <Show
          when={view() === 'editor' && video()}
          fallback={<IdleView onVideoSelected={handleVideoSelected} />}
        >
          {(v) => <EditorView video={v()} onBack={handleBack} />}
        </Show>
      </Show>
      <Show when={IS_DEV}>
        <DevBar active={devTab()} onChange={setDevTab} />
      </Show>
    </>
  );
};

export default App;
