import { createEffect, on } from 'solid-js';
import { Spring } from '../engine/spring';
import { ANIM } from '../engine/config';
import { ensureRunning } from '../engine/loop';
import { calculateBBoxTargets, type AppViewState } from '../engine/bbox-calc';
import { canvasW, canvasH } from './ui';
import { appState } from './app';

// Bounding box coordinate springs
export const x1Spring = new Spring(0, ANIM.bbox);
export const y1Spring = new Spring(0, ANIM.bbox);
export const x2Spring = new Spring(0, ANIM.bbox);
export const y2Spring = new Spring(0, ANIM.bbox);

// Center marker opacity spring
export const centerOpacity = new Spring(1, ANIM.fade);

// Video opacity spring
export const videoOpacity = new Spring(0, ANIM.fade);

function getViewState(): AppViewState {
  if (appState.view === 'idle' || !appState.videoMeta) return 'idle';
  return 'loaded';
}

function getMediaAspect(): number | null {
  const meta = appState.videoMeta;
  if (!meta) return null;
  return meta.videoWidth / meta.videoHeight;
}

// React to canvas size changes and state transitions
export function initBBoxEffects(): void {
  createEffect(
    on(
      () => [canvasW(), canvasH(), appState.view, appState.videoMeta] as const,
      () => {
        const w = canvasW();
        const h = canvasH();
        if (w <= 0 || h <= 0) return;

        const viewState = getViewState();
        const mediaAspect = getMediaAspect();
        const targets = calculateBBoxTargets(w, h, mediaAspect, viewState);

        x1Spring.setTarget(targets.x1);
        y1Spring.setTarget(targets.y1);
        x2Spring.setTarget(targets.x2);
        y2Spring.setTarget(targets.y2);

        // Center marker: visible in idle, hidden when media loaded
        centerOpacity.setTarget(viewState === 'idle' ? 1 : 0);

        // Video: hidden in idle, visible when media loaded
        videoOpacity.setTarget(viewState === 'idle' ? 0 : 1);

        ensureRunning();
      },
    ),
  );
}

/** Snap all bbox springs instantly (no animation) — for initial mount */
export function snapBBox(w: number, h: number): void {
  const viewState = getViewState();
  const mediaAspect = getMediaAspect();
  const targets = calculateBBoxTargets(w, h, mediaAspect, viewState);
  x1Spring.snap(targets.x1);
  y1Spring.snap(targets.y1);
  x2Spring.snap(targets.x2);
  y2Spring.snap(targets.y2);
  centerOpacity.snap(viewState === 'idle' ? 1 : 0);
  videoOpacity.snap(viewState === 'idle' ? 0 : 1);
}
