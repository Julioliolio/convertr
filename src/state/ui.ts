import { createSignal } from 'solid-js';

// Canvas dimensions (updated by ResizeObserver in MainCanvas)
const [canvasW, setCanvasW] = createSignal(0);
const [canvasH, setCanvasH] = createSignal(0);

// Panel expand/collapse state
const [panelExpanded, setPanelExpanded] = createSignal(false);

export {
  canvasW, setCanvasW,
  canvasH, setCanvasH,
  panelExpanded, setPanelExpanded,
};
