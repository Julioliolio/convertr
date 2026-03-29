import { Component, onMount, onCleanup, createEffect, type Accessor } from 'solid-js';
import { Rive, StateMachineInput } from '@rive-app/canvas';

interface RiveWrapperProps {
  src: string;
  stateMachine?: string;
  artboard?: string;
  width?: number;
  height?: number;
  inputs?: Record<string, Accessor<boolean | number>>;
  class?: string;
  style?: string | Record<string, string>;
}

const RiveWrapper: Component<RiveWrapperProps> = (props) => {
  let canvasRef: HTMLCanvasElement | undefined;
  let riveInstance: Rive | undefined;

  onMount(() => {
    if (!canvasRef) return;

    riveInstance = new Rive({
      src: props.src,
      canvas: canvasRef,
      autoplay: true,
      stateMachines: props.stateMachine ? [props.stateMachine] : undefined,
      artboard: props.artboard,
      onLoad: () => {
        riveInstance?.resizeDrawingSurfaceToCanvas();
      },
    });
  });

  // Sync inputs to state machine
  createEffect(() => {
    if (!riveInstance || !props.inputs) return;
    const inputs = riveInstance.stateMachineInputs(props.stateMachine || '');
    if (!inputs) return;

    for (const [name, accessor] of Object.entries(props.inputs)) {
      const input = inputs.find((i: StateMachineInput) => i.name === name);
      if (input) {
        const val = accessor();
        if (typeof val === 'boolean') {
          input.value = val;
        } else if (typeof val === 'number') {
          input.value = val;
        }
      }
    }
  });

  onCleanup(() => {
    riveInstance?.cleanup();
  });

  return (
    <canvas
      ref={canvasRef}
      width={props.width ?? 200}
      height={props.height ?? 200}
      class={props.class}
      style={props.style}
    />
  );
};

export default RiveWrapper;
