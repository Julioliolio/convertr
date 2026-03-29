import { Component, Show } from 'solid-js';
import { appState, setAppState } from '../../state/app';
import { startDrag, getOutputPath, isElectron } from '../../utils/electron-bridge';

const OutputView: Component = () => {
  const handleBack = () => {
    setAppState('view', 'editor');
    setAppState('progress', 0);
    setAppState('progressMsg', '');
    setAppState('resultUrl', null);
    setAppState('resultFilename', null);
    setAppState('converting', false);
  };

  const handleDownload = async () => {
    const url = appState.resultUrl;
    const filename = appState.resultFilename;
    if (!url) return;

    const jobId = appState.currentJobId;
    if (jobId) {
      const downloadUrl = `/download/${jobId}`;
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = filename || 'output';
      a.click();
    }
  };

  const handleDragOut = async () => {
    if (!isElectron() || !appState.currentJobId) return;
    const outputPath = await getOutputPath(appState.currentJobId);
    if (outputPath) startDrag(outputPath);
  };

  const isGif = () => appState.outputFormat === 'gif';
  const progressPct = () => `${Math.round(appState.progress)}%`;

  return (
    <div
      class="view active"
      style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}
    >
      <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column', padding: 'var(--sp-4)' }}>
        {/* Progress section */}
        <Show when={appState.converting}>
          <div style={{ 'margin-bottom': 'var(--sp-6)' }}>
            <div class="progress-label" style={{
              'font-size': 'var(--t-sm)',
              'font-weight': '700',
              'letter-spacing': 'var(--ls-label)',
              'text-transform': 'uppercase',
              'margin-bottom': 'var(--sp-2)',
            }}>
              {appState.progressMsg || 'Converting...'}
            </div>
            <div class="progress-bar-bg" style={{
              height: '4px',
              background: 'var(--surface)',
              'border-radius': '2px',
              overflow: 'hidden',
            }}>
              <div class="progress-bar-fill" style={{
                height: '100%',
                background: 'var(--accent)',
                width: progressPct(),
                transition: 'width 0.3s',
              }} />
            </div>
            <div style={{
              'font-size': 'var(--t-xs)',
              color: 'var(--text-muted)',
              'margin-top': 'var(--sp-1)',
            }}>
              {progressPct()}
            </div>
          </div>
        </Show>

        {/* Result section */}
        <Show when={appState.resultUrl}>
          <div style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}>
            <div
              class="result-preview"
              style={{
                flex: '1',
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'center',
                background: 'var(--surface)',
                'min-height': '0',
                overflow: 'hidden',
                cursor: isElectron() ? 'grab' : 'default',
              }}
              onMouseDown={handleDragOut}
            >
              <Show when={isGif()} fallback={
                <video
                  src={appState.resultUrl!}
                  controls
                  style={{ 'max-width': '100%', 'max-height': '100%' }}
                />
              }>
                <img
                  src={appState.resultUrl!}
                  alt="Result"
                  style={{ 'max-width': '100%', 'max-height': '100%' }}
                />
              </Show>
            </div>

            <div style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              'margin-top': 'var(--sp-3)',
              'justify-content': 'center',
            }}>
              <button class="run-btn" onClick={handleDownload}>DOWNLOAD</button>
              <button class="run-btn" style={{ background: 'var(--surface)', color: 'var(--text)' }} onClick={handleBack}>BACK</button>
            </div>
          </div>
        </Show>

        {/* Waiting state */}
        <Show when={!appState.resultUrl && !appState.converting}>
          <div style={{
            flex: '1',
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'center',
            color: 'var(--text-muted)',
          }}>
            Processing complete
          </div>
        </Show>
      </div>
    </div>
  );
};

export default OutputView;
