import { Component, Show, createSignal } from 'solid-js';
import IdleView from './components/views/IdleView';
import EditorView from './components/views/EditorView';

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
    <Show
      when={view() === 'editor' && video()}
      fallback={<IdleView onVideoSelected={handleVideoSelected} />}
    >
      {(v) => <EditorView video={v()} onBack={handleBack} />}
    </Show>
  );
};

export default App;
