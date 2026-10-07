// Browser port of the arg builders in server-utils.js (buildGifFilters,
// getCodecArgs, getFastCutArgs, buildProxyArgs) — keep the two in sync.
// Deliberate differences, all down to the single-threaded ffmpeg.wasm core:
//   • x264 uses `veryfast` (speed over compression).
//   • WebM is VP8: libvpx-vp9 crashes this core ("memory access out of
//     bounds") with every setting tried.
//   • No H.265: x265 is too slow to be usable (the UI hides the toggle).

export const VALID_OUTPUT = ['gif', 'mp4', 'webm', 'mov', 'avi', 'mkv', 'mp3'];

const BROWSER_PLAYABLE = new Set(['mp4', 'mov', 'm4v', 'webm', 'ogv', '3gp']);
export const isBrowserPlayable = (ext: string) => BROWSER_PLAYABLE.has(ext.toLowerCase());

export const MIME: Record<string, string> = {
  gif: 'image/gif', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  avi: 'video/x-msvideo', mkv: 'video/x-matroska', mp3: 'audio/mpeg',
};

export function buildGifFilters(opts: { fps: number | string; width: number | string; dither: string }) {
  const fpsOriginal = opts.fps === 'original';
  const fps = fpsOriginal ? null : Math.min(60, Math.max(1, parseInt(String(opts.fps)) || 15));
  const width = opts.width === 'original' ? -1 : Math.min(1920, Math.max(240, parseInt(String(opts.width)) || 640));
  const ditherVal = ['sierra2_4a', 'bayer', 'floyd_steinberg', 'none'].includes(opts.dither)
    ? opts.dither : 'sierra2_4a';
  const fpsPart = fpsOriginal ? '' : `fps=${fps},`;
  const scaleFilter = `${fpsPart}scale=${width === -1 ? 'iw' : width}:-1:flags=lanczos`;
  return { scaleFilter, ditherVal, fps };
}

export function getCodecArgs(
  outputFormat: string,
  opts: { crf: number; width: number; fps: number | string; audio: boolean },
): string[] {
  const { crf, width, fps, audio } = opts;
  const fpsVal = fps && fps !== 'original' ? Math.min(120, Math.max(1, parseInt(String(fps)) || 0)) : 0;

  if (outputFormat === 'mp3') return ['-vn', '-c:a', 'libmp3lame', '-b:a', '192k'];

  let args: string[];
  switch (outputFormat) {
    case 'webm':
      // VP8 constrained quality: the UI's CRF is tuned for VP9, so use
      // VP8's own sweet spot with a generous bitrate ceiling.
      args = ['-c:v', 'libvpx', '-crf', '10', '-b:v', '4M', '-deadline', 'realtime', '-cpu-used', '8',
        ...(audio ? ['-c:a', 'libopus', '-b:a', '128k'] : ['-an'])];
      break;
    case 'mp4':
    case 'mov':
    case 'avi':
    case 'mkv': {
      const colorArgs = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709'];
      args = ['-c:v', 'libx264', '-crf', String(crf), '-preset', 'veryfast', '-pix_fmt', 'yuv420p', ...colorArgs,
        ...(audio ? ['-c:a', 'aac', '-b:a', '128k', '-ar', '48000'] : ['-an'])];
      if (outputFormat === 'mp4' || outputFormat === 'mov') args.push('-movflags', '+faststart');
      break;
    }
    default:
      return ['-c:v', 'libx264', '-crf', '23', '-c:a', 'aac'];
  }

  if (fpsVal > 0) args.push('-r', String(fpsVal));
  if (width !== -1) args.push('-vf', `scale=${width}:-2`);
  return args;
}

export function getFastCutArgs(audio: boolean, sourceCodec: string, outputFormat: string): string[] {
  const args = audio
    ? ['-c', 'copy', '-avoid_negative_ts', 'make_zero']
    : ['-c:v', 'copy', '-an', '-avoid_negative_ts', 'make_zero'];
  const isMp4ish = outputFormat === 'mp4' || outputFormat === 'mov';
  if (isMp4ish && sourceCodec === 'hevc') args.push('-tag:v', 'hvc1');
  if (isMp4ish) args.push('-movflags', '+faststart');
  return args;
}

export function buildProxyArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-i', inputPath,
    '-vf', "scale='min(1280,iw)':'min(720,ih)':force_original_aspect_ratio=decrease",
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
    '-movflags', '+faststart',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '96k',
    outputPath,
  ];
}
