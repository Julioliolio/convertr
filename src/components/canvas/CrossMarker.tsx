import { Component, type Accessor } from 'solid-js';

interface CrossMarkerProps {
  x: Accessor<number>;
  y: Accessor<number>;
  opacity?: Accessor<number>;
}

const CrossMarker: Component<CrossMarkerProps> = (props) => {
  return (
    <div
      class="cross"
      style={{
        transform: `translate(${props.x() - 10}px, ${props.y() - 10}px)`,
        opacity: props.opacity ? props.opacity() : 1,
      }}
    />
  );
};

export default CrossMarker;
