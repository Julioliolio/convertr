import { setAppState } from '../state/app';

export async function fetchFromUrl(
  url: string,
  onProgress: (msg: string) => void,
): Promise<{ file: File; meta: { duration: number; videoWidth: number; videoHeight: number } } | null> {
  onProgress('Fetching...');

  try {
    const res = await fetch('/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Fetch failed' }));
      onProgress(`Error: ${err.error || 'Fetch failed'}`);
      return null;
    }

    const data = await res.json();
    if (data.jobId) {
      setAppState('fileUrl', url);
      setAppState('inputMode', 'url');
      setAppState('currentJobId', data.jobId);
      onProgress('Ready');
      return null; // URL mode doesn't return a file, it stores server-side
    }

    onProgress('Ready');
    return null;
  } catch (err) {
    onProgress(`Error: ${err instanceof Error ? err.message : 'Unknown error'}`);
    return null;
  }
}
