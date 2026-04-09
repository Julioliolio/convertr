/** Format seconds as a short string, e.g. "12s" */
export const fmtDuration = (s: number) => `${Math.round(s)}s`;

/** Format byte count as a human-readable MB string */
export const fmtBytes = (bytes: number) => {
  const mb = bytes / 1_048_576;
  if (mb < 0.1) return '<0.1 MB';
  if (mb < 10)  return mb.toFixed(1) + ' MB';
  return Math.round(mb) + ' MB';
};

/**
 * Extract N evenly-spaced thumbnail frames from a video source URL.
 * Returns an array of base64 data-URLs (JPEG, 0.8 quality).
 */
export const extractFrames = (src: string, duration: number, count: number): Promise<string[]> =>
  new Promise((resolve) => {
    const vid = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    vid.src = src; vid.muted = true; vid.preload = 'auto';
    const results: string[] = [];
    let idx = 0; let thumbW = 24;
    const seekNext = () => { if (idx >= count) { resolve(results); return; } vid.currentTime = (idx / count) * duration + 0.01; };
    vid.addEventListener('seeked', () => { ctx.drawImage(vid, 0, 0, thumbW, 24); results.push(canvas.toDataURL('image/jpeg', 0.8)); idx++; seekNext(); });
    vid.addEventListener('loadedmetadata', () => { thumbW = Math.round(24 * vid.videoWidth / vid.videoHeight); canvas.width = thumbW; canvas.height = 24; seekNext(); });
  });
