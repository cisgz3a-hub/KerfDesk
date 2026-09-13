import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCameraDirector } from './camera-director';
import type { CameraRig } from './scene-setup';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = performance.now();
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  let onStart: (() => void) | null = null;
  const camera = new PerspectiveCamera(40, 1, 0.1, 100_000);
  camera.up.set(0, 0, 1);
  camera.position.set(200, -200, 200);
  const controls = {
    target: new Vector3(),
    update: vi.fn(),
    addEventListener: vi.fn((_event: string, listener: () => void) => {
      onStart = listener;
    }),
    removeEventListener: vi.fn(),
  };
  const director = createCameraDirector({
    camera,
    controls,
    render: vi.fn(),
  } as unknown as CameraRig);
  const step = (): void => {
    const callbacks = [...pending.values()];
    pending.clear();
    now += 16;
    callbacks.forEach((callback) => callback(now));
  };
  return { director, camera, controls, pending, step, interact: () => onStart?.() };
}

describe('camera director lifecycle', () => {
  it('smoothly tracks reports and settles without an idle render loop', () => {
    const s = setup();
    const point = { x: 70, y: 30, z: -2 };
    s.director.track({ mode: 'auto', point, progress: 0.4 });
    s.step();
    expect(s.controls.target.x).toBeGreaterThan(0);
    expect(s.controls.target.x).toBeLessThan(point.x);
    for (let frame = 0; frame < 240; frame += 1) s.step();
    expect(s.controls.target.x).toBe(point.x);
    expect(s.pending.size).toBe(0);
    s.director.dispose();
  });

  it('yields to manual interaction and cancels pending work on disposal', () => {
    const s = setup();
    const manual = vi.fn();
    s.director.onManual(manual);
    s.director.track({ mode: 'follow', point: { x: 1, y: 2, z: 3 }, progress: 0 });
    s.interact();
    expect(manual).toHaveBeenCalledOnce();
    expect(s.pending.size).toBe(0);
    s.director.track({ mode: 'follow', point: { x: 2, y: 3, z: 4 }, progress: 0 });
    s.director.dispose();
    expect(s.pending.size).toBe(0);
    expect(s.controls.removeEventListener).toHaveBeenCalledWith('start', expect.any(Function));
    s.director.track({ mode: 'auto', point: { x: 9, y: 9, z: 9 }, progress: 1 });
    expect(s.pending.size).toBe(0);
  });
});
