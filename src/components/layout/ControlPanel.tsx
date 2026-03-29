import { Component, Show } from 'solid-js';
import { appState, fps, setFps, width, setWidth, vidWidth, setVidWidth, crf, setCrf } from '../../state/app';
import Slider from '../controls/Slider';

const fpsSnaps = [1, 12, 24, 30, 60];
const widthMap = (v: number) => Math.round(240 + (v / 90) * (1920 - 240));
const widthUnmap = (px: number) => Math.round(((px - 240) / (1920 - 240)) * 90);

const ControlPanel: Component = () => {
  const isGif = () => appState.outputFormat === 'gif';

  return (
    <div class="controls-panel">
      <Show when={isGif()}>
        <div class="ctrl-group">
          <Slider
            label="FPS"
            unit="FPS"
            min={1}
            max={60}
            value={fps}
            onChange={setFps}
            snaps={fpsSnaps}
          />
          <Slider
            label="WIDTH"
            unit="PX"
            min={0}
            max={90}
            value={() => widthUnmap(width())}
            onChange={(v) => setWidth(widthMap(v))}
            displayValue={() => String(width())}
            snaps={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90]}
          />
        </div>
      </Show>
      <Show when={!isGif()}>
        <div class="ctrl-group">
          <Slider
            label="WIDTH"
            unit="PX"
            min={0}
            max={90}
            value={() => vidWidth() === 0 ? 90 : widthUnmap(vidWidth())}
            onChange={(v) => setVidWidth(v >= 90 ? 0 : widthMap(v))}
            displayValue={() => vidWidth() === 0 ? 'orig' : String(vidWidth())}
            snaps={[0, 10, 20, 30, 40, 50, 60, 70, 80, 90]}
          />
          <Slider
            label="CRF"
            unit=""
            min={0}
            max={51}
            value={crf}
            onChange={setCrf}
            snaps={[0, 18, 23, 32, 51]}
          />
        </div>
      </Show>

      <button
        class="run-btn"
        disabled={!appState.selectedFile && !appState.fileUrl || appState.converting}
        onClick={() => {
          // Import and run conversion - handled by EditorView
          document.dispatchEvent(new CustomEvent('convertr:run'));
        }}
      >
        RUN
      </button>
    </div>
  );
};

export default ControlPanel;
