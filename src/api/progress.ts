import { appState, setAppState } from '../state/app';

let stopCurrent: (() => void) | null = null;

export function listenProgress(
  jobId: string,
  onComplete: (resultUrl: string, filename: string, outputSize: number | null) => void,
  onError?: () => void,
): void {
  stopProgress();

  let finished = false;
  const finish = () => { finished = true; stopProgress(); };

  // Payloads are the server's SSE messages; the web build's engine emits the
  // same shape directly.
  const handle = (data: any) => {
    if (finished) return;
    if (data.progress !== undefined && data.progress !== appState.progress) {
      setAppState('progress', data.progress);
    }
    if (data.message && data.message !== appState.progressMsg) {
      setAppState('progressMsg', data.message);
    }
    if (data.done) {
      finish();
      // Force progress to 100 so the smoothed loading bar always sweeps
      // all the way to the end (server may signal done with progress<100).
      if (appState.progress !== 100) setAppState('progress', 100);
      // Do not flip `converting` here — the caller holds it true until
      // the loading bar's animation finishes, so the result media can't
      // appear mid-fill on a fast conversion.
      const resultUrl = data.resultUrl || `/serve/${jobId}`;
      const filename = data.filename || `output.${data.outputFormat || 'gif'}`;
      const outputSize = typeof data.outputSize === 'number' ? data.outputSize : null;
      onComplete(resultUrl, filename, outputSize);
    }
    if (data.error) {
      finish();
      setAppState('converting', false);
      setAppState('progressMsg', `Error: ${data.message || 'Unknown error'}`);
      onError?.();
    }
  };

  if (__WEB__) {
    let unsubscribe: (() => void) | null = null;
    stopCurrent = () => { finished = true; unsubscribe?.(); };
    import('../web/engine').then(e => {
      if (!finished) unsubscribe = e.webListen(jobId, handle);
    });
    return;
  }

  const sse = new EventSource(`/progress/${jobId}`);
  stopCurrent = () => sse.close();

  sse.onmessage = (event) => {
    try {
      handle(JSON.parse(event.data));
    } catch {
      // ignore parse errors
    }
  };

  sse.onerror = () => {
    if (finished) return;
    finish();
    setAppState('converting', false);
    onError?.();
  };
}

export function stopProgress(): void {
  if (stopCurrent) {
    stopCurrent();
    stopCurrent = null;
  }
}
