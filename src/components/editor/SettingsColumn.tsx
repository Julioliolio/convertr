import { Component } from 'solid-js';
import VideoSettings from '../controls/VideoSettings';

// Video settings column — slider placeholder boxes + dither canvas.
// The parent positions/sizes this absolutely via the forwarded ref (left/top/width/height).
const SettingsColumn: Component<{
  ref: (el: HTMLDivElement) => void;
  videoEl?: HTMLVideoElement;
  open?: boolean;
  isPortrait?: boolean;
}> = (p) => (
  <div
    ref={p.ref}
    style={{ position: 'absolute', overflow: 'hidden', '-webkit-app-region': 'no-drag' } as any}
  >
    <VideoSettings videoEl={p.videoEl} open={p.open} isPortrait={p.isPortrait} />
  </div>
);

export default SettingsColumn;
