import type { AxisBounds } from '../../core/gcode-view';
import type { CameraRig } from './scene-setup';
import { boundsExtent, type CameraPlacement } from './camera-presets';
import { trackingPlacement, type CameraTracking } from './camera-tracking';

/** An on-demand animation: settles to the latest report then releases rAF.
 * User orbit/pan/zoom cancels immediately and yields ownership to the UI. */
export function createCameraDirector(rig: CameraRig): {
  readonly track: (tracking: CameraTracking) => void;
  readonly setBounds: (bounds: AxisBounds | null) => void;
  readonly onManual: (listener: (() => void) | null) => void;
  readonly stop: () => void;
  readonly dispose: () => void;
} {
  let bounds: AxisBounds | null = null;
  let destination: CameraPlacement | null = null;
  let frame = 0;
  let lastTime = 0;
  let disposed = false;
  let manualListener: (() => void) | null = null;
  const media =
    typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const { camera, controls, render } = rig;
  const stop = (): void => {
    cancelAnimationFrame(frame);
    frame = 0;
    destination = null;
  };
  const manual = (): void => {
    stop();
    manualListener?.();
  };
  const tick = (now: number): void => {
    frame = 0;
    if (disposed || destination === null) return;
    const alpha = media?.matches ? 1 : 1 - Math.exp(-Math.min(0.1, (now - lastTime) / 1000) * 7);
    lastTime = now;
    const error = moveCamera(rig, destination, alpha);
    if (error > Math.max(0.0001, boundsExtent(bounds) * 0.00001)) {
      frame = requestAnimationFrame(tick);
    } else {
      moveCamera(rig, destination, 1);
    }
    render();
  };
  controls.addEventListener('start', manual);
  return {
    track: (tracking) => {
      if (disposed) return;
      destination = trackingPlacement(tracking, bounds, camera.aspect, media?.matches);
      if (destination === null) {
        stop();
        return;
      }
      if (frame === 0) {
        lastTime = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    setBounds: (next) => {
      stop();
      bounds = next;
    },
    onManual: (listener) => {
      manualListener = listener;
    },
    stop,
    dispose: () => {
      disposed = true;
      stop();
      controls.removeEventListener('start', manual);
      manualListener = null;
    },
  };
}

function moveCamera(rig: CameraRig, view: CameraPlacement, alpha: number): number {
  let error = 0;
  for (const [current, target] of [
    [rig.camera.position, view.position],
    [rig.controls.target, view.target],
    [rig.camera.up, view.up],
  ] as const) {
    for (const axis of ['x', 'y', 'z'] as const) {
      current[axis] += (target[axis] - current[axis]) * alpha;
      error = Math.max(error, Math.abs(target[axis] - current[axis]));
    }
  }
  rig.camera.lookAt(rig.controls.target);
  rig.controls.update();
  return error;
}
