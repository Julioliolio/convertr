import { Component, Show, createEffect, onCleanup } from 'solid-js';
import { appState, setAppState, type VideoMeta } from '../../state/app';
import { x1Spring, y1Spring, x2Spring, y2Spring, videoOpacity } from '../../state/bbox';
import { canvasW, canvasH } from '../../state/ui';

const VideoLayer: Component = () => {
  let videoRef: HTMLVideoElement | undefined;
  let imgRef: HTMLImageElement | undefined;

  const clipPath = () => {
    const cw = canvasW();
    const ch = canvasH();
    const top = y1Spring.signal();
    const right = cw - x2Spring.signal();
    const bottom = ch - y2Spring.signal();
    const left = x1Spring.signal();
    return `inset(${top}px ${right}px ${bottom}px ${left}px)`;
  };

  const isImage = () => {
    const file = appState.selectedFile;
    if (!file) return false;
    return file.type.startsWith('image/');
  };

  // Load media when file changes
  createEffect(() => {
    const file = appState.selectedFile;
    if (!file) return;

    const url = URL.createObjectURL(file);

    if (isImage()) {
      if (imgRef) {
        imgRef.src = url;
        imgRef.onload = () => {
          setAppState('videoMeta', {
            duration: 0,
            videoWidth: imgRef!.naturalWidth,
            videoHeight: imgRef!.naturalHeight,
          });
        };
      }
    } else {
      if (videoRef) {
        videoRef.src = url;
        videoRef.onloadedmetadata = () => {
          setAppState('videoMeta', {
            duration: videoRef!.duration,
            videoWidth: videoRef!.videoWidth,
            videoHeight: videoRef!.videoHeight,
          });
          videoRef!.play().catch(() => {});
        };
      }
    }

    onCleanup(() => URL.revokeObjectURL(url));
  });

  return (
    <div
      class="video-layer"
      style={{
        position: 'absolute',
        inset: '0',
        'clip-path': clipPath(),
        opacity: videoOpacity.signal(),
        'pointer-events': 'none',
      }}
    >
      <video
        ref={videoRef}
        muted
        playsinline
        loop
        style={{
          width: '100%',
          height: '100%',
          'object-fit': 'cover',
          display: isImage() ? 'none' : 'block',
        }}
      />
      <img
        ref={imgRef}
        alt=""
        style={{
          width: '100%',
          height: '100%',
          'object-fit': 'cover',
          display: isImage() ? 'block' : 'none',
        }}
      />
    </div>
  );
};

export default VideoLayer;
