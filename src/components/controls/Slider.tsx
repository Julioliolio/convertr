import { Component, type Accessor } from 'solid-js';

interface SliderProps {
  label: string;
  unit: string;
  min: number;
  max: number;
  value: Accessor<number>;
  onChange: (v: number) => void;
  displayValue?: Accessor<string>;
  snaps?: number[];
}

const SNAP_RADIUS = 5;
const SNAP_DURATION = 120;

const Slider: Component<SliderProps> = (props) => {
  let inputRef: HTMLInputElement | undefined;
  let animFrame = 0;

  const fillPercent = () => {
    const range = props.max - props.min;
    if (range <= 0) return '0%';
    return `${((props.value() - props.min) / range) * 100}%`;
  };

  const display = () => props.displayValue ? props.displayValue() : String(props.value());

  const snapToNearest = (value: number): number | null => {
    if (!props.snaps) return null;
    let closest: number | null = null;
    let closestDist = Infinity;
    for (const snap of props.snaps) {
      const dist = Math.abs(value - snap);
      if (dist <= SNAP_RADIUS && dist < closestDist) {
        closest = snap;
        closestDist = dist;
      }
    }
    return closest;
  };

  const handleInput = (e: Event) => {
    const raw = Number((e.target as HTMLInputElement).value);
    props.onChange(raw);
  };

  const handleChange = (e: Event) => {
    const raw = Number((e.target as HTMLInputElement).value);
    const snap = snapToNearest(raw);
    if (snap !== null && snap !== raw) {
      // Animate to snap
      const start = raw;
      const end = snap;
      const startTime = performance.now();
      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / SNAP_DURATION, 1);
        const eased = t * (2 - t); // quadratic ease-out
        const current = Math.round(start + (end - start) * eased);
        props.onChange(current);
        if (t < 1) {
          animFrame = requestAnimationFrame(animate);
        }
      };
      cancelAnimationFrame(animFrame);
      animFrame = requestAnimationFrame(animate);
    }
  };

  return (
    <div class="slider-block">
      <div class="slider-value-badge">
        <span class="v">{display()}</span> {props.unit}
      </div>
      <div class="slider-track-wrap">
        <div class="slider-track-bg" />
        <div class="slider-track-fill" style={{ width: fillPercent() }} />
        <input
          ref={inputRef}
          type="range"
          min={props.min}
          max={props.max}
          value={props.value()}
          onInput={handleInput}
          onChange={handleChange}
        />
      </div>
    </div>
  );
};

export default Slider;
