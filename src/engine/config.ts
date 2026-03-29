export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export const ANIM = {
  bbox:  { stiffness: 180, damping: 24, mass: 1.0 } as SpringParams,
  grid:  { stiffness: 150, damping: 22, mass: 1.0 } as SpringParams,
  fade:  { stiffness: 120, damping: 20, mass: 1.0 } as SpringParams,
  panel: { stiffness: 200, damping: 28, mass: 1.0 } as SpringParams,

  stagger: {
    gridToBox: 30,
    boxToVideo: 60,
    markerFade: 100,
  },

  easing: {
    dropdown: 'cubic-bezier(0.4, 0, 0.2, 1)',
    dropdownDuration: '0.25s',
    opacityDuration: '0.2s',
  },

  epsilon: 0.01,
  maxDt: 0.032,
};
