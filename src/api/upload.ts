// Mirrors MAX_FILE_SIZE in server-config.js.
export const MAX_FILE_BYTES = 500 * 1024 * 1024;

export interface ServerMeta {
  duration: number;
  width: number;
  height: number;
  fps: number;
  bitrate: number;
}

export interface UploadResult {
  jobId: string;
  meta: ServerMeta;
  inputFormat: string;
  needsProxy: boolean;
}

// Upload with real-time byte progress. `onProgress` receives percentages in
// [0, 100]. Uses XHR because fetch() has no upload-progress hook. The web
// build opens the file in-browser instead (nothing is uploaded).
export function uploadFileWithProgress(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<UploadResult | null> {
  if (__WEB__) return import('../web/engine').then(e => e.webUpload(file, onProgress));
  return new Promise((resolve) => {
    const form = new FormData();
    form.append('video', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload');
    xhr.upload.onprogress = (e) => {
      if (!onProgress || !e.lengthComputable) return;
      onProgress(Math.min(100, (e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          onProgress?.(100);
          resolve(JSON.parse(xhr.responseText) as UploadResult);
        } catch {
          resolve(null);
        }
      } else {
        resolve(null);
      }
    };
    xhr.onerror = () => resolve(null);
    xhr.onabort = () => resolve(null);
    xhr.send(form);
  });
}

/**
 * Poll the server until the preview proxy is ready (or timeout).
 * Returns the preview URL when ready, or null on timeout / no-proxy-needed.
 */
export async function waitForPreview(jobId: string, timeoutMs = 60_000): Promise<string | null> {
  if (__WEB__) return (await import('../web/engine')).webWaitForPreview(jobId);
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`/preview-status/${jobId}`);
      if (res.ok) {
        const { ready, needsProxy } = await res.json();
        if (!needsProxy) return null; // original is fine; caller uses /input URL
        if (ready) return `/preview/${jobId}`;
      }
    } catch { /* transient, retry */ }
    await new Promise(r => setTimeout(r, 400));
  }
  return null;
}
