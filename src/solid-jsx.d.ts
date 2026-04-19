// Module augmentations for Solid's JSX types.
// Keeps inline style objects type-safe without `as any` escape hatches.

import 'solid-js';

declare module 'solid-js' {
  namespace JSX {
    interface CSSProperties {
      // Electron drag regions for custom title bars — 'drag' marks a region
      // as the window-drag handle, 'no-drag' opts out for interactive children.
      '-webkit-app-region'?: 'drag' | 'no-drag';
    }
  }
}
