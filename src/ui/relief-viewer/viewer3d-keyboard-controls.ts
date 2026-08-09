export type Viewer3DCameraControl =
  | { readonly kind: 'pan'; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'rotate'; readonly deltaX: number; readonly deltaY: number }
  | { readonly kind: 'zoom'; readonly deltaY: number };

const KEYBOARD_MOVE_STEP_PX = 12;
const KEYBOARD_ZOOM_STEP_PX = 100;
const ZOOM_EXPONENT_PER_PIXEL = 0.001;

/** Maps focused-canvas keys onto the same compact controls used by pointer input. */
export function viewer3DCameraControlForKey(
  event: Pick<KeyboardEvent, 'key' | 'shiftKey'>,
): Viewer3DCameraControl | null {
  if (event.key === '+' || event.key === '=') {
    return { kind: 'zoom', deltaY: -KEYBOARD_ZOOM_STEP_PX };
  }
  if (event.key === '-' || event.key === '_') {
    return { kind: 'zoom', deltaY: KEYBOARD_ZOOM_STEP_PX };
  }
  const delta = arrowDelta(event.key);
  if (delta === null) return null;
  return event.shiftKey ? { kind: 'rotate', ...delta } : { kind: 'pan', ...delta };
}

/** Converts the existing wheel-style delta into a bounded-camera distance scale. */
export function viewer3DZoomScale(deltaY: number): number {
  return Math.exp(deltaY * ZOOM_EXPONENT_PER_PIXEL);
}

function arrowDelta(key: string): { readonly deltaX: number; readonly deltaY: number } | null {
  if (key === 'ArrowLeft') return { deltaX: KEYBOARD_MOVE_STEP_PX, deltaY: 0 };
  if (key === 'ArrowRight') return { deltaX: -KEYBOARD_MOVE_STEP_PX, deltaY: 0 };
  if (key === 'ArrowUp') return { deltaX: 0, deltaY: KEYBOARD_MOVE_STEP_PX };
  if (key === 'ArrowDown') return { deltaX: 0, deltaY: -KEYBOARD_MOVE_STEP_PX };
  return null;
}
