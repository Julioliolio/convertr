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
  uploadJobId: string | null;
  uploadReady: boolean;
  estimatedBytes: number | null;
  estimating: boolean;
  // ── Conversion parameters ───────────────────────────────────────────────
  fps: number;
  width: number;       // GIF output width (px, 0 = original)
  vidWidth: number;    // non-GIF output width (px, 0 = original)
  crf: number;
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
  uploadJobId: null,
  uploadReady: false,
  estimatedBytes: null,
  estimating: false,
  fps: 12,
  width: 640,
  vidWidth: 0,    // 0 = original
  crf: 23,
});

export { appState, setAppState };
