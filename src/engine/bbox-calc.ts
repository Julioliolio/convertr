export type AppViewState = 'idle' | 'loaded' | 'interaction';

export interface BBoxTargets {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const DEFAULT_ASPECT = 16 / 9;
const PADDING = 32;

// Idle state: bbox occupies a moderate centered area
const IDLE_W_RATIO = 0.64;
const IDLE_H_RATIO = 0.50;

export function calculateBBoxTargets(
  canvasW: number,
  canvasH: number,
  mediaAspect: number | null,
  state: AppViewState,
): BBoxTargets {
  if (canvasW <= 0 || canvasH <= 0) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  if (state === 'idle') {
    // Default centered box
    let bboxW = canvasW * IDLE_W_RATIO;
    let bboxH = canvasH * IDLE_H_RATIO;
    // Constrain to default aspect ratio
    const currentAspect = bboxW / bboxH;
    if (currentAspect > DEFAULT_ASPECT) {
      bboxW = bboxH * DEFAULT_ASPECT;
    } else {
      bboxH = bboxW / DEFAULT_ASPECT;
    }
    const x1 = (canvasW - bboxW) / 2;
    const y1 = (canvasH - bboxH) / 2;
    return { x1, y1, x2: x1 + bboxW, y2: y1 + bboxH };
  }

  // loaded or interaction: maximize within canvas respecting media aspect ratio
  const aspect = mediaAspect ?? DEFAULT_ASPECT;
  const availW = canvasW - 2 * PADDING;
  const availH = canvasH - 2 * PADDING;

  let bboxW: number;
  let bboxH: number;

  if (availW / availH > aspect) {
    bboxH = availH;
    bboxW = bboxH * aspect;
  } else {
    bboxW = availW;
    bboxH = bboxW / aspect;
  }

  const x1 = (canvasW - bboxW) / 2;
  const y1 = (canvasH - bboxH) / 2;
  return { x1, y1, x2: x1 + bboxW, y2: y1 + bboxH };
}
