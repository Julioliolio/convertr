import { appState, setAppState } from '../state/app';

let currentSSE: EventSource | null = null;

export function listenProgress(
  jobId: string,
  onComplete: (resultUrl: string, filename: string) => void,
  onError?: () => void,
): void {
  stopProgress();

  const sse = new EventSource(`/progress/${jobId}`);
  currentSSE = sse;

  sse.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.progress !== undefined && data.progress !== appState.progress) {
        setAppState('progress', data.progress);
      }
      if (data.message && data.message !== appState.progressMsg) {
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
        onError?.();
      }
    } catch {
      // ignore parse errors
    }
  };

  sse.onerror = () => {
    sse.close();
    currentSSE = null;
    setAppState('converting', false);
    onError?.();
  };
}

export function stopProgress(): void {
  if (currentSSE) {
    currentSSE.close();
    currentSSE = null;
  }
}
