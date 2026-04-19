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
  // ── Input info (filled after /upload or /fetch) ─────────────────────────
  inputFormat: string | null;      // e.g. "gif", "mp4", "avi"
  previewUrl: string | null;       // server preview proxy URL, null until ready
  needsProxy: boolean;             // source isn't browser-playable in <video>
  // ── Conversion parameters ───────────────────────────────────────────────
  fps: number;
  width: number;       // GIF output width (px, 0 = original)
  vidWidth: number;    // non-GIF output width (px, 0 = original)
  crf: number;
  audio: boolean;      // keep audio track on non-GIF outputs
  fastCut: boolean;    // stream-copy when input format === output format
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
  inputFormat: null,
  previewUrl: null,
  needsProxy: false,
  fps: 12,
  width: 640,
  vidWidth: 0,    // 0 = original
  crf: 23,
  audio: true,
  fastCut: true,  // on by default for same-format trim; no effect otherwise
});

export { appState, setAppState };
