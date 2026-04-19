import { appState, setAppState } from '../state/app';

/**
 * Kick off a conversion on the server. Returns the job id, or null if something
 * went wrong before the server could accept the job.
 *
 * There are three input modes:
 *   1. File already uploaded (uploadJobId present) → /convert-fetched
 *   2. URL previously fetched (fileUrl + currentJobId present) → /convert-fetched
 *   3. Raw local file → /convert (multipart, multer picks it up)
 */
export async function startConversion(trimStart?: number, trimEnd?: number): Promise<string | null> {
  const file         = appState.selectedFile;
  const fileUrl      = appState.fileUrl;
  const uploadJobId  = appState.uploadJobId;
  if (!file && !fileUrl) return null;

  // Width: 0 means "keep original". GIF uses .width, everything else .vidWidth.
  const widthPx = appState.outputFormat === 'gif' ? appState.width : appState.vidWidth;
  const widthArg = widthPx > 0 ? widthPx : 'original';

  const commonBody = {
    outputFormat: appState.outputFormat,
    fps:          Math.round(appState.fps),
    width:        widthArg,
    dither:       appState.dither,
    crf:          appState.crf,
    codec:        appState.codec,
    audio:        appState.audio,
    fastCut:      appState.fastCut,
    trimStart,
    trimEnd,
  };

  try {
    let res: Response;

    if (uploadJobId) {
      // Pre-uploaded mode: file already on server from /upload
      res = await fetch('/convert-fetched', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId: uploadJobId, ...commonBody }),
      });
    } else if (fileUrl) {
      // URL mode: server already has the file from /fetch
      const fetchJobId = appState.currentJobId;
      if (!fetchJobId) return null;
      res = await fetch('/convert-fetched', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ jobId: fetchJobId, ...commonBody }),
      });
    } else {
      // Raw-file mode: send multipart so multer puts fields on req.body
      const form = new FormData();
      form.append('video', file!);
      form.append('outputFormat', appState.outputFormat);
      form.append('fps',    String(Math.round(appState.fps)));
      form.append('dither', appState.dither);
      form.append('codec',  appState.codec);
      form.append('crf',    String(appState.crf));
      form.append('audio',  String(appState.audio));
      form.append('fastCut', String(appState.fastCut));
      if (widthPx > 0)      form.append('width',     String(widthPx));
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
