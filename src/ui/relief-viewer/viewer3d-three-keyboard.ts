import type { PerspectiveCamera, Vector3 } from 'three';
import { viewer3DCameraControlForKey, viewer3DZoomScale } from './viewer3d-keyboard-controls';

export type Viewer3DThreeKeyboardControls = {
  readonly enabled: boolean;
  readonly target: Vector3;
  readonly minDistance: number;
  readonly maxDistance: number;
  readonly listenToKeyEvents: (element: HTMLElement | Window) => void;
  readonly stopListenToKeyEvents: () => void;
  readonly update: () => boolean;
};

/** Enables focused-canvas pan, orbit, and zoom without taking global shortcuts. */
export function installViewer3DThreeKeyboard(
  canvas: HTMLCanvasElement,
  camera: PerspectiveCamera,
  controls: Viewer3DThreeKeyboardControls,
): () => void {
  const preserveHostModifiedArrow = (event: KeyboardEvent): void => {
    if (isHostModifiedArrow(event)) event.stopImmediatePropagation();
  };
  canvas.addEventListener('keydown', preserveHostModifiedArrow, { capture: true });
  controls.listenToKeyEvents(canvas);
  const handleKeyDown = (event: KeyboardEvent): void => {
    const control = viewer3DCameraControlForKey(event);
    if (!controls.enabled || control?.kind !== 'zoom') return;
    event.preventDefault();
    applyZoom(camera, controls, control.deltaY);
  };
  canvas.addEventListener('keydown', handleKeyDown);
  return () => {
    canvas.removeEventListener('keydown', preserveHostModifiedArrow, { capture: true });
    canvas.removeEventListener('keydown', handleKeyDown);
    controls.stopListenToKeyEvents();
  };
}

// OrbitControls owns modified arrows as well as the documented Shift variant.
// Keep Ctrl/Cmd/Alt chords away from that target listener without preventing
// their browser or Electron default action.
function isHostModifiedArrow(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey'>,
): boolean {
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return false;
  return (
    event.key === 'ArrowLeft' ||
    event.key === 'ArrowRight' ||
    event.key === 'ArrowUp' ||
    event.key === 'ArrowDown'
  );
}

function applyZoom(
  camera: PerspectiveCamera,
  controls: Viewer3DThreeKeyboardControls,
  deltaY: number,
): void {
  const offset = camera.position.clone().sub(controls.target);
  const distance = offset.length();
  if (distance === 0) return;
  const nextDistance = clamp(
    distance * viewer3DZoomScale(deltaY),
    controls.minDistance,
    controls.maxDistance,
  );
  camera.position.copy(controls.target).add(offset.multiplyScalar(nextDistance / distance));
  controls.update();
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
