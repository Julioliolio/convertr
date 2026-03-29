import { Component } from 'solid-js';
import { gridH1, gridH2, gridV1, gridV2 } from '../../state/grid';

const GridLines: Component = () => {
  return (
    <>
      {/* Horizontal lines */}
      <div
        class="guide-h"
        style={{ transform: `translateY(${gridH1.signal()}px)` }}
      />
      <div
        class="guide-h"
        style={{ transform: `translateY(${gridH2.signal()}px)` }}
      />
      {/* Vertical lines */}
      <div
        class="guide-v"
        style={{ transform: `translateX(${gridV1.signal()}px)` }}
      />
      <div
        class="guide-v"
        style={{ transform: `translateX(${gridV2.signal()}px)` }}
      />
    </>
  );
};

export default GridLines;
