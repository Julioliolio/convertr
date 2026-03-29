import { Component, onMount, onCleanup } from 'solid-js';
import { setCanvasW, setCanvasH } from '../../state/ui';
import { initBBoxEffects, snapBBox, x1Spring, y1Spring, x2Spring, y2Spring, centerOpacity } from '../../state/bbox';
import { initGridEffects, snapGrid } from '../../state/grid';
import GridLines from './GridLines';
import CrossMarker from './CrossMarker';
import VideoLayer from './VideoLayer';

const MainCanvas: Component = () => {
  let containerRef: HTMLDivElement | undefined;
  let observer: ResizeObserver | undefined;

  onMount(() => {
    if (!containerRef) return;

    // Initialize reactive effects
    initBBoxEffects();
    initGridEffects();

    observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        const w = Math.round(width);
        const h = Math.round(height);
        setCanvasW(w);
        setCanvasH(h);
      }
    });

    observer.observe(containerRef);

    // Snap to initial dimensions (no animation on first render)
    const rect = containerRef.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    setCanvasW(w);
    setCanvasH(h);
    snapBBox(w, h);
    snapGrid();
  });

  onCleanup(() => {
    observer?.disconnect();
  });

  // Derived accessors for corner markers
  const cx = () => (x1Spring.signal() + x2Spring.signal()) / 2;
  const cy = () => (y1Spring.signal() + y2Spring.signal()) / 2;

  return (
    <div
      ref={containerRef}
      class="main-canvas"
      style={{
        position: 'relative',
        flex: '1',
        'min-height': '0',
        overflow: 'hidden',
      }}
    >
      {/* Grid lines */}
      <GridLines />

      {/* Video layer (clipped by bbox) */}
      <VideoLayer />

      {/* Corner markers */}
      <CrossMarker x={() => x1Spring.signal()} y={() => y1Spring.signal()} />
      <CrossMarker x={() => x2Spring.signal()} y={() => y1Spring.signal()} />
      <CrossMarker x={() => x1Spring.signal()} y={() => y2Spring.signal()} />
      <CrossMarker x={() => x2Spring.signal()} y={() => y2Spring.signal()} />

      {/* Center marker (fades on media load) */}
      <CrossMarker x={cx} y={cy} opacity={() => centerOpacity.signal()} />
    </div>
  );
};

export default MainCanvas;
