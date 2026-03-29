import { Component } from 'solid-js';
import FormatPicker from '../controls/FormatPicker';
import { appState, setAppState, type OutputFormat } from '../../state/app';

const formatOptions: OutputFormat[] = ['gif', 'avi', 'mp4', 'mov', 'webm', 'mkv'];
const ditherOptions = ['sierra2_4a', 'floyd_steinberg', 'bayer', 'none'];
const codecOptions = [
  { value: 'h264', label: 'H.264' },
  { value: 'h265', label: 'H.265' },
];

const TopBar: Component = () => {
  const isGif = () => appState.outputFormat === 'gif';

  return (
    <div class="editor-topbar">
      <div class="topbar-left">
        <FormatPicker
          value={() => appState.outputFormat.toUpperCase()}
          options={formatOptions.map(f => ({ value: f, label: f.toUpperCase() }))}
          onSelect={(v) => setAppState('outputFormat', v as OutputFormat)}
        />
      </div>
      <div class="topbar-right">
        {isGif() ? (
          <FormatPicker
            value={() => appState.dither}
            options={ditherOptions.map(d => ({ value: d, label: d }))}
            onSelect={(v) => setAppState('dither', v)}
          />
        ) : (
          <FormatPicker
            value={() => codecOptions.find(c => c.value === appState.codec)?.label ?? 'H.264'}
            options={codecOptions}
            onSelect={(v) => setAppState('codec', v)}
          />
        )}
      </div>
    </div>
  );
};

export default TopBar;
