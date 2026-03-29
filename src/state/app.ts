import { createSignal, createRoot } from 'solid-js';
import { createStore } from 'solid-js/store';

export type ViewName = 'idle' | 'editor' | 'output';
export type OutputFormat = 'gif' | 'avi' | 'mp4' | 'mov' | 'webm' | 'mkv';
export type InputMode = 'file' | 'url';

export interface VideoMeta {
  duration: number;
  videoWidth: number;
  videoHeight: number;
}

export interface AppState {
  view: ViewName;
  inputMode: InputMode;
  outputFormat: OutputFormat;
  selectedFile: File | null;
  fileUrl: string | null;
  videoMeta: VideoMeta | null;
  converting: boolean;
  currentJobId: string | null;
  progress: number;
  progressMsg: string;
  dither: string;
  codec: string;
  resultUrl: string | null;
  resultFilename: string | null;
}

const [appState, setAppState] = createStore<AppState>({
  view: 'idle',
  inputMode: 'file',
  outputFormat: 'gif',
  selectedFile: null,
  fileUrl: null,
  videoMeta: null,
  converting: false,
  currentJobId: null,
  progress: 0,
  progressMsg: '',
  dither: 'sierra2_4a',
  codec: 'h264',
  resultUrl: null,
  resultFilename: null,
});

// Slider values as separate signals for high-frequency updates
const [fps, setFps] = createSignal(12);
const [width, setWidth] = createSignal(640);
const [vidWidth, setVidWidth] = createSignal(0); // 0 = original
const [crf, setCrf] = createSignal(23);

export {
  appState, setAppState,
  fps, setFps,
  width, setWidth,
  vidWidth, setVidWidth,
  crf, setCrf,
};
