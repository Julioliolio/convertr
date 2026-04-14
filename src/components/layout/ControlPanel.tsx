import { Component, Show } from 'solid-js';
import { appState, setAppState } from '../../state/app';
import Slider from '../controls/Slider';

const fpsSnaps    = [1, 12, 24, 30, 60];
const widthSnaps  = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
const crfSnaps    = [0, 18, 23, 32, 51];

// Maps a normalized 0..90 slider value to a pixel width in [240, 1920].
const widthMap   = (v: number) => Math.round(240 + (v / 90) * (1920 - 240));
const widthUnmap = (px: number) => Math.round(((px - 240) / (1920 - 240)) * 90);

const ControlPanel: Component<{ onRun: () => void }> = (props) => {
  const isGif = () => appState.outputFormat === 'gif';

  return (
    <div class="controls-panel">
      <Show when={isGif()}>
        <div class="ctrl-group">
          <Slider
            label="FPS" unit="FPS" min={1} max={60}
            value={() => appState.fps}
            onChange={(v) => setAppState('fps', v)}
            snaps={fpsSnaps}
          />
          <Slider
            label="WIDTH" unit="PX" min={0} max={90}
            value={() => widthUnmap(appState.width)}
            onChange={(v) => setAppState('width', widthMap(v))}
            displayValue={() => String(appState.width)}
            snaps={widthSnaps}
          />
        </div>
      </Show>
      <Show when={!isGif()}>
        <div class="ctrl-group">
          <Slider
            label="FPS" unit="FPS" min={1} max={60}
            value={() => appState.fps}
            onChange={(v) => setAppState('fps', v)}
            snaps={fpsSnaps}
          />
          <Slider
            label="WIDTH" unit="PX" min={0} max={90}
            value={() => appState.vidWidth === 0 ? 90 : widthUnmap(appState.vidWidth)}
            onChange={(v) => setAppState('vidWidth', v >= 90 ? 0 : widthMap(v))}
            displayValue={() => appState.vidWidth === 0 ? 'orig' : String(appState.vidWidth)}
            snaps={widthSnaps}
          />
          <Slider
            label="CRF" unit="" min={0} max={51}
            value={() => appState.crf}
            onChange={(v) => setAppState('crf', v)}
            snaps={crfSnaps}
          />
        </div>
      </Show>

      <button
        class="run-btn"
        disabled={!appState.selectedFile && !appState.fileUrl || appState.converting}
        onClick={props.onRun}
      >
        RUN
      </button>
    </div>
  );
};

export default ControlPanel;
