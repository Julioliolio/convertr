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
}

export async function uploadFile(file: File): Promise<UploadResult | null> {
  try {
    const form = new FormData();
    form.append('video', file);
    const res = await fetch('/upload', { method: 'POST', body: form });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
