import { Component, createSignal } from 'solid-js';
import SettingsCanvas from '../controls/SettingsCanvas';
import { ACCENT, BG, MONO } from '../../shared/tokens';

// NOTE: The batch processing code lives in `controls/BatchCanvas.tsx` and
// `controls/BatchThumbnail.tsx`. Those files are intentionally NOT imported
// here — keep the playground focused on the dither canvas. Pick batch up from
// those modules when you're ready to resume.

const CanvasPlayground: Component = () => {
  const [canvasWidth, setCanvasWidth] = createSignal(597);
  const [videoSrc, setVideoSrc] = createSignal<string | null>('/dev-mock.mp4');
  const [videoEl, setVideoEl] = createSignal<HTMLVideoElement | undefined>();
  let fileInputRef!: HTMLInputElement;

  const handleFile = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      const old = videoSrc();
      if (old && old !== '/dev-mock.mp4') URL.revokeObjectURL(old);
      setVideoSrc(URL.createObjectURL(file));
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: '0', background: BG,
      display: 'flex', 'align-items': 'flex-start', 'justify-content': 'flex-start',
      padding: '40px', gap: '40px',
    }}>
      {/* Canvas preview */}
      <div style={{
        display: 'flex', 'flex-direction': 'column', gap: '16px',
        width: `${canvasWidth()}px`, 'flex-shrink': '0',
      }}>
        {/* Hidden video for frame extraction — rendered first so the ref is available */}
        <video
          ref={(el) => setVideoEl(el)}
          src={videoSrc() ?? undefined}
          muted
          preload="auto"
          style={{ display: 'none' }}
          onLoadedData={(e) => { (e.target as HTMLVideoElement).currentTime = 1; }}
        />
        <SettingsCanvas videoEl={videoEl()} />
      </div>

      {/* Controls */}
      <div style={{
        display: 'flex', 'flex-direction': 'column', gap: '16px',
        'font-family': MONO, 'min-width': '240px',
      }}>
        <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em' }}>CANVAS SIZE</div>

        <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', 'font-size': '11px', color: '#555' }}>
          <span style={{ width: '50px', 'flex-shrink': '0' }}>width</span>
          <input
            type="range" min={200} max={800} value={canvasWidth()}
            onInput={(e) => setCanvasWidth(Number(e.currentTarget.value))}
            style={{ width: '140px' }}
          />
          <span style={{ width: '40px', 'text-align': 'right', color: ACCENT }}>{canvasWidth()}px</span>
        </div>

        <div style={{ 'font-size': '10px', color: '#333', 'letter-spacing': '0.08em', 'margin-top': '12px' }}>VIDEO SOURCE</div>

        <div style={{ display: 'flex', gap: '6px' }}>
          <button
            onClick={() => fileInputRef.click()}
            style={{
              background: 'transparent', border: `1px solid #2a2a2a`,
              color: '#555', cursor: 'pointer', padding: '4px 10px',
              'font-family': MONO, 'font-size': '10px',
            }}
          >
            load video
          </button>
          <button
            onClick={() => setVideoSrc('/dev-mock.mp4')}
            style={{
              background: 'transparent', border: `1px solid #2a2a2a`,
              color: '#555', cursor: 'pointer', padding: '4px 10px',
              'font-family': MONO, 'font-size': '10px',
            }}
          >
            use mock
          </button>
        </div>
        <input ref={fileInputRef} type="file" accept="video/*" style={{ display: 'none' }} onChange={handleFile} />
      </div>
    </div>
  );
};

export default CanvasPlayground;
