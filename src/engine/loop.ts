import { ANIM } from './config';
import type { Spring } from './spring';

const springs = new Set<Spring>();
let running = false;
let lastTime = 0;

export function registerSpring(spring: Spring): void {
  springs.add(spring);
}

export function unregisterSpring(spring: Spring): void {
  springs.delete(spring);
}

function tick(now: number): void {
  if (!running) return;

  const rawDt = lastTime === 0 ? 0.016 : (now - lastTime) / 1000;
  const dt = Math.min(rawDt, ANIM.maxDt);
  lastTime = now;

  let anyActive = false;
  for (const spring of springs) {
    if (spring.tick(dt)) {
      anyActive = true;
    }
  }

  if (anyActive) {
    requestAnimationFrame(tick);
  } else {
    running = false;
    lastTime = 0;
  }
}

/** Ensure the RAF loop is running (call after setting new spring targets). */
export function ensureRunning(): void {
  if (running) return;
  running = true;
  lastTime = 0;
  requestAnimationFrame(tick);
}
