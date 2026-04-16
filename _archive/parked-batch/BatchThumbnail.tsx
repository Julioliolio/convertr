import { Component, createSignal, Show } from 'solid-js';
import { ACCENT, ACCENT_75, BG, MONO } from '../../shared/tokens';

// ── Types ──────────────────────────────────────────────────────────────────
export type BatchFile = {
  name: string;
  /** Upper-cased file extension used for the corner badge ("MP4", "MOV"…). */
  type: string;
  /** Poster image URL (dataURL or blob URL). Empty string while a preview is
   *  still being generated — the thumbnail will show a loading placeholder. */
  url: string;
  /** Size in bytes; formatted on-the-fly by formatBytes() for the caption. */
  size: number;
};

// ── Helpers ────────────────────────────────────────────────────────────────
/** Byte count → short human string ("2.4 MB", "640 KB", "12 B"). */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

/** Extract a single poster frame from a video file and return it as a JPEG
 *  dataURL. Seeks ~1s in (or ¼ of duration for very short clips) so we skip
 *  the all-black first frame most editors hand us.
 *
 *  Resolves with the dataURL or rejects on decode/load error. The caller is
 *  responsible for handling both cases — typically by leaving `url` empty so
 *  the thumbnail renders its loading/error placeholder. */
export const extractVideoFrame = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    const blobUrl = URL.createObjectURL(file);
    video.src = blobUrl;

    const cleanup = () => URL.revokeObjectURL(blobUrl);

    video.addEventListener('loadedmetadata', () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 4;
      video.currentTime = Math.min(1, dur / 4);
    }, { once: true });

    video.addEventListener('seeked', () => {
      try {
        const maxDim = 500;
        const scale = Math.min(1, maxDim / Math.max(video.videoWidth, video.videoHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      } catch (e) {
        reject(e);
      } finally {
        cleanup();
      }
    }, { once: true });

    video.addEventListener('error', () => {
      cleanup();
      reject(new Error(`failed to load video: ${file.name}`));
    }, { once: true });
  });
};

// ── Component ──────────────────────────────────────────────────────────────
const BatchThumbnail: Component<{
  file: BatchFile;
  /** Whether this thumbnail is currently part of the user's selection.
   *  Controlled — the parent decides. */
  selected?: boolean;
  /** Px cut off the bottom of the image on hover to reveal the filename/size
   *  caption. Clamped 0–80 internally; defaults to 30. */
  hoverCutoff?: number;
  /** Thickness of the pink frame drawn around the thumbnail when `selected`.
   *  The outer footprint stays 125×175 — the image shrinks inward. */
  selectedBorder?: number;
  /** Click handler — typically toggles `selected` in the parent. */
  onClick?: () => void;
}> = (props) => {
  const [hovered, setHovered] = createSignal(false);

  const cutoff = () => Math.max(0, Math.min(80, props.hoverCutoff ?? 30));
  const selBorder = () => Math.max(0, Math.min(10, props.selectedBorder ?? 5));
  const capH = () => hovered() ? cutoff() : 0;
  const isReady = () => !!props.file.url;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => props.onClick?.()}
      style={{
        position: 'relative',
        width: '125px', height: '175px',
        padding: `${props.selected ? selBorder() : 0}px`,
        background: props.selected ? ACCENT : 'transparent',
        'box-sizing': 'border-box',
        cursor: 'pointer',
        'flex-shrink': '0',
        transition: 'padding 0.15s ease, background-color 0.15s ease',
      }}
    >
      <div style={{ position: 'relative', width: '100%', height: '100%' }}>
        {/* Image portion — shrinks from the bottom on hover */}
        <div style={{
          position: 'absolute',
          top: '0', left: '0', right: '0',
          height: hovered() ? `calc(100% - ${cutoff()}px)` : '100%',
          'background-image': isReady() ? `url(${props.file.url})` : 'none',
          'background-color': isReady() ? 'transparent' : '#ebeae9',
          'background-size': 'cover',
          'background-position': 'top',
          'background-repeat': 'no-repeat',
          border: `1px solid ${ACCENT_75}`,
          'box-sizing': 'border-box',
          overflow: 'clip',
          transition: 'height 0.18s ease',
        }}>
          <Show
            when={isReady()}
            fallback={
              <div style={{
                position: 'absolute', inset: '0',
                display: 'flex', 'align-items': 'center', 'justify-content': 'center',
                'font-family': MONO, 'font-size': '9px',
                color: 'rgba(26,26,26,0.42)', 'letter-spacing': '0.18em',
              }}>
                LOADING
              </div>
            }
          >
            {/* Format badge — top right */}
            <div style={{
              position: 'absolute', top: '4px', right: '4px',
              background: ACCENT,
              display: 'flex', 'align-items': 'center',
              height: '16px', padding: '0 2px',
            }}>
              <span style={{
                'font-family': MONO, 'font-size': '12px', 'line-height': '16px',
                color: BG,
              }}>
                {props.file.type}
              </span>
            </div>
            {/* Pink checkmark — centered */}
            <svg width="21" height="22" viewBox="0 0 79 86" fill="none" preserveAspectRatio="none"
              style={{
                position: 'absolute',
                left: '50%', top: '50%',
                translate: '-50% -50%',
                'pointer-events': 'none',
              }}>
              <rect width="78.198" height="85.175" fill={ACCENT} />
              <rect x="29.78" y="54.609" width="40" height="6" transform="rotate(-45 29.78 54.609)" fill={BG} />
              <rect width="20" height="6" transform="matrix(0.707 0.707 0.707 -0.707 19.891 44.709)" fill={BG} />
            </svg>
          </Show>
        </div>
        {/* Caption — grows from 0 to cutoff on hover */}
        <div style={{
          position: 'absolute',
          bottom: '0', left: '0', right: '0',
          height: `${capH()}px`,
          overflow: 'hidden',
          'padding-top': '4px',
          display: 'flex', 'flex-direction': 'column',
          gap: '1px',
          transition: 'height 0.18s ease',
          'pointer-events': 'none',
          // When selected, the outer frame is already pink — paint the caption
          // slot to match so the text reads against the frame colour.
          background: props.selected ? ACCENT : 'transparent',
        }}>
          <div style={{
            'font-family': MONO, 'font-size': '10px', 'line-height': '14px',
            color: props.selected ? BG : ACCENT,
            'white-space': 'nowrap', overflow: 'hidden',
            'text-overflow': 'ellipsis',
          }}>
            {props.file.name}
          </div>
          <div style={{
            'font-family': MONO, 'font-size': '9px', 'font-weight': '300',
            'line-height': '12px',
            color: props.selected ? 'rgba(255,255,255,0.8)' : '#888',
            'letter-spacing': '0.04em',
          }}>
            {formatBytes(props.file.size)}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BatchThumbnail;
