import { useRef } from 'react';
import type { HsvColor } from './editor-color';

const PICKER_KEY_STEP = 0.01;
const PICKER_KEY_LARGE_STEP = 0.1;

/** Render the pointer- and arrow-key-operable saturation/brightness pad. */
export function ColorPickerPad(props: {
  readonly hsv: HsvColor;
  readonly onChange: (update: (current: HsvColor) => HsvColor) => void;
}): JSX.Element {
  const padRef = useRef<HTMLDivElement | null>(null);
  const setFromPad = (event: React.PointerEvent<HTMLDivElement>): void => {
    const pad = padRef.current;
    if (pad === null) return;
    const rect = pad.getBoundingClientRect();
    const saturation = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const brightness = 1 - Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    props.onChange((current) => ({ ...current, s: saturation, v: brightness }));
  };
  return (
    <div
      ref={padRef}
      style={{ ...padStyle, backgroundColor: `hsl(${Math.round(props.hsv.h)}, 100%, 50%)` }}
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        setFromPad(event);
      }}
      onPointerMove={(event) => {
        if (event.buttons === 1) setFromPad(event);
      }}
      onKeyDown={(event) => handleKeyDown(event, props.onChange)}
      role="slider"
      aria-label="Saturation and brightness"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(props.hsv.s * 100)}
      aria-valuetext={`saturation ${Math.round(props.hsv.s * 100)}%, brightness ${Math.round(props.hsv.v * 100)}%`}
      tabIndex={0}
      title="Drag or use arrows to pick saturation (left/right) and brightness (up/down)"
    >
      <span
        style={{
          ...padCursorStyle,
          left: `${props.hsv.s * 100}%`,
          top: `${(1 - props.hsv.v) * 100}%`,
        }}
      />
    </div>
  );
}

function handleKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
  onChange: (update: (current: HsvColor) => HsvColor) => void,
): void {
  const update = pickerPadKeyUpdate(event.key, event.shiftKey);
  if (update === null) return;
  event.preventDefault();
  onChange((current) => update(current));
}

function pickerPadKeyUpdate(
  key: string,
  isLargeStep: boolean,
): ((current: HsvColor) => HsvColor) | null {
  const step = isLargeStep ? PICKER_KEY_LARGE_STEP : PICKER_KEY_STEP;
  switch (key) {
    case 'ArrowLeft':
      return (current) => ({ ...current, s: clampUnit(current.s - step) });
    case 'ArrowRight':
      return (current) => ({ ...current, s: clampUnit(current.s + step) });
    case 'ArrowDown':
      return (current) => ({ ...current, v: clampUnit(current.v - step) });
    case 'ArrowUp':
      return (current) => ({ ...current, v: clampUnit(current.v + step) });
    default:
      return null;
  }
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// White→hue horizontally, transparent→black vertically: literal color math.
/* eslint-disable no-restricted-syntax */
const padStyle: React.CSSProperties = {
  position: 'relative',
  height: 140,
  borderRadius: 6,
  cursor: 'crosshair',
  backgroundImage:
    'linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, rgba(255, 255, 255, 0))',
  touchAction: 'none',
};

const padCursorStyle: React.CSSProperties = {
  position: 'absolute',
  width: 10,
  height: 10,
  marginLeft: -5,
  marginTop: -5,
  borderRadius: '50%',
  border: '2px solid #fff',
  boxShadow: '0 0 0 1px #000',
  pointerEvents: 'none',
};
/* eslint-enable no-restricted-syntax */
