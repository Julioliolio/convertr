import { appState, setAppState, fps, width, vidWidth, crf } from '../state/app';

export interface ConvertOptions {
  outputFormat: string;
  fps: number;
  width: number;
  dither: string;
  codec: string;
  crf: number;
  trimStart?: number;
  trimEnd?: number;
}

export async function startConversion(trimStart?: number, trimEnd?: number): Promise<string | null> {
  const file = appState.selectedFile;
  const fileUrl = appState.fileUrl;
  const uploadJobId = appState.uploadJobId;
  if (!file && !fileUrl) return null;

  // Width: 0 means original
  const w = appState.outputFormat === 'gif' ? width() : vidWidth();

  try {
    let res: Response;

    if (uploadJobId) {
      // Pre-uploaded mode: file already on server from /upload or /fetch — skip re-upload
      res = await fetch('/convert-fetched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: uploadJobId,
          outputFormat: appState.outputFormat,
          fps: fps(),
          width: w > 0 ? w : 'original',
          dither: appState.dither,
          crf: crf(),
          codec: appState.codec,
          trimStart,
          trimEnd,
        }),
      });
    } else if (fileUrl) {
      // URL mode: server already has the file from /fetch — call /convert-fetched
      const fetchJobId = appState.currentJobId;
      if (!fetchJobId) return null;
      res = await fetch('/convert-fetched', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId: fetchJobId,
          outputFormat: appState.outputFormat,
          fps: fps(),
          width: w > 0 ? w : 'original',
          dither: appState.dither,
          crf: crf(),
          codec: appState.codec,
          trimStart,
          trimEnd,
        }),
      });
    } else {
      // File mode: send file + params as multipart form so multer puts them in req.body
      const form = new FormData();
      form.append('video', file!);
      form.append('outputFormat', appState.outputFormat);
      form.append('fps', String(fps()));
      form.append('dither', appState.dither);
      form.append('codec', appState.codec);
      form.append('crf', String(crf()));
      if (w > 0) form.append('width', String(w));
      if (trimStart != null) form.append('trimStart', String(trimStart));
      if (trimEnd   != null) form.append('trimEnd',   String(trimEnd));
      res = await fetch('/convert', { method: 'POST', body: form });
    }

    const data = await res.json();
    if (data.jobId) {
      setAppState('currentJobId', data.jobId);
      return data.jobId;
    }
    return null;
  } catch (err) {
    console.error('Conversion start failed:', err);
    return null;
  }
}
