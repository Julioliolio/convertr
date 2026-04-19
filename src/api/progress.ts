import { appState, setAppState } from '../state/app';

let currentSSE: EventSource | null = null;

export function listenProgress(
  jobId: string,
  onComplete: (resultUrl: string, filename: string, outputSize: number | null) => void,
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
        // Force progress to 100 so the smoothed loading bar always sweeps
        // all the way to the end (server may signal done with progress<100).
        if (appState.progress !== 100) setAppState('progress', 100);
        // Do not flip `converting` here — the caller holds it true until
        // the loading bar's animation finishes, so the result media can't
        // appear mid-fill on a fast conversion.
        const resultUrl = `/serve/${jobId}`;
        const filename = data.filename || `output.${data.outputFormat || 'gif'}`;
        const outputSize = typeof data.outputSize === 'number' ? data.outputSize : null;
        onComplete(resultUrl, filename, outputSize);
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
