import { setAppState } from '../state/app';

let currentSSE: EventSource | null = null;

export function listenProgress(
  jobId: string,
  onComplete: (resultUrl: string, filename: string) => void,
): void {
  stopProgress();

  const sse = new EventSource(`/progress/${jobId}`);
  currentSSE = sse;

  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.progress !== undefined) {
        setAppState('progress', data.progress);
      }
      if (data.message) {
        setAppState('progressMsg', data.message);
      }
      if (data.done) {
        sse.close();
        currentSSE = null;
        setAppState('converting', false);

        const resultUrl = `/serve/${jobId}`;
        const filename = data.filename || `output.${data.outputFormat || 'gif'}`;
        onComplete(resultUrl, filename);
      }
      if (data.error) {
        sse.close();
        currentSSE = null;
        setAppState('converting', false);
        setAppState('progressMsg', `Error: ${data.message || 'Unknown error'}`);
      }
    } catch {
      // ignore parse errors
    }
  };

  sse.onerror = () => {
    sse.close();
    currentSSE = null;
  };
}

export function stopProgress(): void {
  if (currentSSE) {
    currentSSE.close();
    currentSSE = null;
  }
}
