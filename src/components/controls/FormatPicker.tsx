import { Component, For, createSignal, onCleanup, type Accessor } from 'solid-js';
import { ANIM } from '../../engine/config';

interface PickerOption {
  value: string;
  label: string;
}

interface FormatPickerProps {
  value: Accessor<string>;
  options: PickerOption[];
  onSelect: (value: string) => void;
}

const FormatPicker: Component<FormatPickerProps> = (props) => {
  const [open, setOpen] = createSignal(false);
  let containerRef: HTMLDivElement | undefined;

  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      setOpen(false);
    }
  };

  document.addEventListener('click', handleClickOutside);
  onCleanup(() => document.removeEventListener('click', handleClickOutside));

  return (
    <div class="fmt-picker" ref={containerRef}>
      <button class="picker-btn" onClick={() => setOpen(!open())}>
        <span>{props.value()}</span>
        <span class="picker-arrow">&#9660;</span>
      </button>
      <div
        class="picker-dropdown"
        classList={{ open: open() }}
        style={{
          transition: `opacity ${ANIM.easing.dropdownDuration} ${ANIM.easing.dropdown}`,
        }}
      >
        <For each={props.options}>
          {(opt) => (
            <button
              class="picker-opt"
              classList={{ active: props.value() === opt.label || props.value() === opt.value.toUpperCase() }}
              onClick={() => {
                props.onSelect(opt.value);
                setOpen(false);
              }}
            >
              {opt.label}
            </button>
          )}
        </For>
      </div>
    </div>
  );
};

export default FormatPicker;
