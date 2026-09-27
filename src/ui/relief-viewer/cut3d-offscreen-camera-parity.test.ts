import { afterEach, expect, it, vi } from 'vitest';
import * as three from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { configureViewer3dControls } from '../viewer3d/viewer3d-controls';
import { createViewer3dGlideRendering } from '../viewer3d/viewer3d-glide-rendering';
import {
  applyCut3DCameraControl,
  cut3DCameraPose,
  initialCut3DCameraState,
} from './cut3d-offscreen-camera';
import { createCut3DOffscreenInput } from './cut3d-offscreen-input';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

function canvas(): HTMLCanvasElement {
  const element = document.createElement('canvas');
  document.body.append(element);
  Object.defineProperty(element, 'clientHeight', { value: 400 });
  Object.defineProperty(element, 'clientWidth', { value: 600 });
  element.setPointerCapture = vi.fn();
  element.releasePointerCapture = vi.fn();
  return element;
}

function pointer(element: HTMLCanvasElement, kind: string, clientX: number, button: number): void {
  const event = new MouseEvent(kind, {
    button,
    buttons: kind === 'pointerup' ? 0 : button === 2 ? 2 : 1,
    clientX,
    clientY: 100,
    bubbles: true,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, pointerType: { value: 'mouse' } });
  element.dispatchEvent(event);
}

function frameClock() {
  let now = 0;
  let id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (frameId: number) => pending.delete(frameId));
  return {
    advance: (ms: number) => {
      now += ms;
    },
    drain: () => {
      let frames = 0;
      while (pending.size > 0 && frames < 180) {
        now += 1000 / 60;
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach((callback) => callback(now));
        frames += 1;
      }
      expect(pending.size).toBe(0);
    },
    pending: () => pending.size,
  };
}

// Use the actual installed OrbitControls as the reference, not a second
// copy of the damping formula. The old velocity glide travelled 8.62 times
// farther for this 20 px / 16 ms flick, while reduced motion already matched.
it.each([
  { button: 2, reducedMotion: false },
  { button: 2, reducedMotion: true },
  { button: 0, reducedMotion: false },
  { button: 0, reducedMotion: true },
])(
  'settles the same pointer flick as OrbitControls ($button, reduced=$reducedMotion)',
  ({ button, reducedMotion }) => {
    const frames = frameClock();
    vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
    const orbitCanvas = canvas();
    const cutCanvas = canvas();
    let cutState = initialCut3DCameraState(100, 60, 10);
    const start = cutState;
    const pose = cut3DCameraPose(cutState);
    const camera = new three.PerspectiveCamera(40, 1.5, 0.1, 100000);
    camera.up.set(0, 0, 1);
    camera.position.set(...pose.position);
    const orbit = new OrbitControls(camera, orbitCanvas);
    configureViewer3dControls(three, orbit);
    // A real renderer updates camera matrices on each draw; panning reads
    // those basis columns, so the no-WebGL reference must do the same.
    const rendering = createViewer3dGlideRendering(orbit, () => camera.updateMatrixWorld());
    rendering.render();
    const cutInput = createCut3DOffscreenInput(
      cutCanvas,
      (control) => {
        cutState = applyCut3DCameraControl(cutState, control, { widthPx: 600, heightPx: 400 });
      },
      () => undefined,
    );
    cutInput.start();
    try {
      for (const element of [orbitCanvas, cutCanvas]) pointer(element, 'pointerdown', 100, button);
      frames.advance(16);
      for (const element of [orbitCanvas, cutCanvas]) pointer(element, 'pointermove', 120, button);
      for (const element of [orbitCanvas, cutCanvas]) pointer(element, 'pointerup', 120, button);
      frames.drain();
      const offset = camera.position.clone().sub(orbit.target);
      expect(cutState.yawRad).toBeCloseTo(Math.atan2(offset.y, offset.x), 4);
      expect(cutState.pitchRad).toBeCloseTo(
        Math.atan2(offset.z, Math.hypot(offset.x, offset.y)),
        4,
      );
      // OrbitControls stops once its change is below the render epsilon. The
      // remaining pan must differ by less than 0.05 input pixels at this scale.
      const mmPerPixel = (2 * start.radiusMm * Math.tan((20 * Math.PI) / 180)) / 400;
      expect(
        orbit.target.distanceTo(
          new three.Vector3(cutState.targetX, cutState.targetY, cutState.targetZ),
        ),
      ).toBeLessThan(mmPerPixel * 0.05);
      expect(cutState.radiusMm).toBeCloseTo(offset.length(), 6);
      expect(camera.up.toArray()).toEqual([0, 0, 1]);
    } finally {
      cutInput.dispose();
      rendering.dispose();
      orbit.dispose();
    }
    expect(frames.pending()).toBe(0);
  },
);

it.each(['pointercancel', 'wheel', 'keyboard', 'dispose'])(
  'retires pending movement on %s',
  (action) => {
    const frames = frameClock();
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const element = canvas();
    const send = vi.fn();
    const input = createCut3DOffscreenInput(element, send, vi.fn());
    input.start();
    pointer(element, 'pointerdown', 100, 2);
    frames.advance(16);
    pointer(element, 'pointermove', 120, 2);
    expect(frames.pending()).toBe(1);
    if (action === 'pointercancel') pointer(element, 'pointercancel', 120, 2);
    else if (action === 'wheel') element.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    else if (action === 'keyboard')
      element.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }));
    else input.dispose();
    const count = send.mock.calls.length;
    expect(frames.pending()).toBe(0);
    frames.drain();
    expect(send).toHaveBeenCalledTimes(count);
    input.dispose();
  },
);
