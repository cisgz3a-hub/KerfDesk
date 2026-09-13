import { PerspectiveCamera, Vector3 } from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCameraDirector } from './camera-director';
import { createViewer3dRenderScheduler } from './create-viewer3d-render-scheduler';
import type { CameraRig } from './scene-setup';

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const pending = new Map<number, FrameRequestCallback>();
  let id = 0;
  let now = performance.now();
  let frame = 0;
  const renderedFrames: number[] = [];
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    pending.set(++id, callback);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
  const listeners = new Map<string, Set<() => void>>();
  const camera = new PerspectiveCamera(40, 1, 0.1, 100_000);
  camera.up.set(0, 0, 1);
  camera.position.set(200, -200, 200);
  const controls = {
    target: new Vector3(),
    update: () => listeners.get('change')?.forEach((listener) => listener()),
    addEventListener: (event: string, listener: () => void) => {
      const group = listeners.get(event) ?? new Set<() => void>();
      group.add(listener);
      listeners.set(event, group);
    },
    removeEventListener: (event: string, listener: () => void) => {
      listeners.get(event)?.delete(listener);
    },
  } as unknown as CameraRig['controls'];
  const scheduler = createViewer3dRenderScheduler({
    render: () => renderedFrames.push(frame),
    renderChangeEvents: controls,
  });
  const director = createCameraDirector({ camera, controls, render: scheduler.requestRender });
  const step = (): void => {
    frame += 1;
    now += 16;
    // New callbacks wait for the next browser frame; cancellation also removes
    // callbacks from the current frame when they have not executed yet.
    for (const key of [...pending.keys()]) {
      const callback = pending.get(key);
      pending.delete(key);
      callback?.(now);
    }
  };
  const dispose = (): void => {
    scheduler.dispose();
    director.dispose();
  };
  return { director, scheduler, controls, pending, renderedFrames, step, dispose };
}

describe('camera tracking and scene rendering', () => {
  it('coalesces queued report draws and camera animation into one draw per browser frame', () => {
    const s = setup();
    // Scene sync requests the playhead draw before the camera effect starts.
    s.scheduler.requestRender();
    s.director.track({ mode: 'auto', point: { x: 1, y: 2, z: 0 }, progress: 0 });
    s.step();
    expect(s.renderedFrames).toHaveLength(1);
    for (let report = 1; report <= 40; report += 1) {
      s.scheduler.requestRender();
      s.director.track({ mode: 'auto', point: { x: report, y: 2, z: 0 }, progress: report / 40 });
      s.step();
    }
    for (let frame = 0; frame < 240; frame += 1) s.step();
    expect(new Set(s.renderedFrames).size).toBe(s.renderedFrames.length);
    expect(s.controls.target.x).toBe(40);
    expect(s.pending.size).toBe(0);
    const settledCount = s.renderedFrames.length;
    s.step();
    expect(s.renderedFrames).toHaveLength(settledCount);
    s.dispose();
  });

  it('cancels both animation and queued scene draws on disposal', () => {
    const s = setup();
    s.scheduler.requestRender();
    s.director.track({ mode: 'follow', point: { x: 1, y: 2, z: 3 }, progress: 0 });
    s.dispose();
    expect(s.pending.size).toBe(0);
    s.step();
    expect(s.renderedFrames).toHaveLength(0);
  });
});
