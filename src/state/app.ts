import { createStore } from 'solid-js/store';

export type OutputFormat = 'gif' | 'avi' | 'mp4' | 'mov' | 'webm' | 'mkv';

export interface AppState {
  outputFormat: OutputFormat;
  selectedFile: File | null;
  fileUrl: string | null;
  converting: boolean;
  currentJobId: string | null;
  progress: number;
  progressMsg: string;
  dither: string;
  codec: string;
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
  outputFormat: 'gif',
  selectedFile: null,
  fileUrl: null,
  converting: false,
  currentJobId: null,
  progress: 0,
  progressMsg: '',
  dither: 'sierra2_4a',
  codec: 'h264',
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
