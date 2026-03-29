import { Component, createSignal, type Accessor } from 'solid-js';
import RiveWrapper from '../../rive/RiveWrapper';

interface RiveButtonProps {
  src: string;
  stateMachine: string;
  active?: Accessor<boolean>;
  onClick?: () => void;
  width?: number;
  height?: number;
  class?: string;
}

const RiveButton: Component<RiveButtonProps> = (props) => {
  const [hovered, setHovered] = createSignal(false);
  const [pressed, setPressed] = createSignal(false);

  const inputs = {
    hovered: hovered as Accessor<boolean>,
    pressed: pressed as Accessor<boolean>,
    ...(props.active ? { active: props.active } : {}),
  };

  return (
    <div
      class={props.class}
      style={{ cursor: 'pointer', display: 'inline-block' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setPressed(false); }}
      onMouseDown={() => setPressed(true)}
      onMouseUp={() => { setPressed(false); props.onClick?.(); }}
    >
      <RiveWrapper
        src={props.src}
        stateMachine={props.stateMachine}
        inputs={inputs}
        width={props.width ?? 120}
        height={props.height ?? 60}
      />
    </div>
  );
};

export default RiveButton;
