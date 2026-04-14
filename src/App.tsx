import { Component, Show, createSignal } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';
import PlaygroundView from './components/views/PlaygroundView';
import SliderPlayground from './components/views/SliderPlayground';
import LoadingPlayground from './components/views/LoadingPlayground';
import DottedBgPlayground from './components/views/DottedBgPlayground';
import CanvasPlayground from './components/views/CanvasPlayground';
import { ACCENT } from './shared/tokens';

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
type PlaygroundTab = 'video' | 'slider' | 'loading' | 'dotted-bg' | 'canvas';

const PLAYGROUND_TABS: { id: PlaygroundTab; label: string }[] = [
  { id: 'video',     label: 'video' },
  { id: 'slider',    label: 'slider' },
  { id: 'loading',   label: 'loading' },
  { id: 'dotted-bg', label: 'dotted bg' },
  { id: 'canvas',    label: 'canvas' },
];

const DEV_TABS: { id: DevTab; label: string }[] = [
  { id: 'app',        label: 'app' },
  { id: 'playground', label: 'playground' },
];

const devBtnStyle = (active: boolean) => ({
  background: active ? ACCENT : 'transparent',
  color: active ? '#fff' : '#666',
  border: 'none', cursor: 'pointer',
  padding: '4px 10px',
  'font-family': 'inherit', 'font-size': 'inherit',
  transition: 'background 0.15s, color 0.15s',
});

const DevBar: Component<{
  active: DevTab;
  onChange: (t: DevTab) => void;
  playgroundTab: PlaygroundTab;
  onPlaygroundTab: (t: PlaygroundTab) => void;
}> = (p) => (
  <div style={{
    position: 'fixed', bottom: '0', left: '0', right: '0',
    display: 'flex', 'align-items': 'center', gap: '1px',
    background: '#111', 'z-index': '9999',
    'font-family': "'IBM Plex Mono', monospace",
    'font-size': '11px',
    'border-top': '1px solid #333',
  }}>
    <span style={{ color: '#555', padding: '4px 8px', 'flex-shrink': '0' }}>dev</span>
    {DEV_TABS.map(t => (
      <button onClick={() => p.onChange(t.id)} style={devBtnStyle(p.active === t.id)}>
        {t.label}
      </button>
    ))}
    <Show when={p.active === 'playground'}>
      <span style={{ color: '#333', padding: '4px 4px', 'flex-shrink': '0' }}>|</span>
      {PLAYGROUND_TABS.map(t => (
        <button onClick={() => p.onPlaygroundTab(t.id)} style={devBtnStyle(p.playgroundTab === t.id)}>
          {t.label}
        </button>
      ))}
    </Show>
  </div>
);

// ── App ───────────────────────────────────────────────────────────────────────
const App: Component = () => {
  const [devTab, setDevTab] = createSignal<DevTab>(IS_DEV ? 'playground' : 'app');
  const [pgTab, setPgTab]   = createSignal<PlaygroundTab>('canvas');
  const [view, setView]     = createSignal<'idle' | 'editor'>('idle');
  const [video, setVideo]   = createSignal<VideoInfo | null>(null);

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
        <Show when={pgTab() === 'video'}>    <PlaygroundView />      </Show>
        <Show when={pgTab() === 'slider'}>   <SliderPlayground />    </Show>
        <Show when={pgTab() === 'loading'}>  <LoadingPlayground />   </Show>
        <Show when={pgTab() === 'dotted-bg'}><DottedBgPlayground />  </Show>
        <Show when={pgTab() === 'canvas'}>   <CanvasPlayground />    </Show>
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
        <DevBar
          active={devTab()} onChange={setDevTab}
          playgroundTab={pgTab()} onPlaygroundTab={setPgTab}
        />
      </Show>
    </>
  );
};

export default App;
