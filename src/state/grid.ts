import { createEffect, on } from 'solid-js';
import { Spring } from '../engine/spring';
import { ANIM } from '../engine/config';
import { ensureRunning } from '../engine/loop';
import { x1Spring, y1Spring, x2Spring, y2Spring } from './bbox';

// Grid lines that track the bounding box edges
// Horizontal lines (Y positions)
export const gridH1 = new Spring(0, ANIM.grid); // tracks y1
export const gridH2 = new Spring(0, ANIM.grid); // tracks y2

// Vertical lines (X positions)
export const gridV1 = new Spring(0, ANIM.grid); // tracks x1
export const gridV2 = new Spring(0, ANIM.grid); // tracks x2

export function initGridEffects(): void {
  createEffect(
    on(
      () => [x1Spring.signal(), y1Spring.signal(), x2Spring.signal(), y2Spring.signal()] as const,
      () => {
        // Grid lines follow bbox with slight stagger (handled by different spring params)
        gridH1.setTarget(y1Spring.target);
        gridH2.setTarget(y2Spring.target);
        gridV1.setTarget(x1Spring.target);
        gridV2.setTarget(x2Spring.target);
        ensureRunning();
      },
    ),
  );
}

/** Snap grid lines instantly */
export function snapGrid(): void {
  gridH1.snap(y1Spring.value);
  gridH2.snap(y2Spring.value);
  gridV1.snap(x1Spring.value);
  gridV2.snap(x2Spring.value);
}
