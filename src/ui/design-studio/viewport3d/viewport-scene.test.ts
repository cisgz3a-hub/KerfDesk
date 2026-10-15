import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Group, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type * as ThreeNamespace from 'three';
import { CAMERA_PRESETS, viewDirection } from '../../viewer3d/camera-presets';
import {
  createDesignViewportScene,
  type DesignViewportHandle,
  type ViewportFrame,
} from './viewport-scene';

const rendered = vi.hoisted(() => ({ camera: null as PerspectiveCamera | null }));

// Keep the real camera, projection maths, OrbitControls and scene lifecycle;
// only the GPU renderer and unrelated stock/overlay drawables are substitutes.
vi.mock('three', async (importOriginal) => ({
  ...(await importOriginal<typeof ThreeNamespace>()),
  WebGLRenderer: class {
    setSize = vi.fn();
    render(_scene: Scene, camera: PerspectiveCamera): void {
      camera.updateMatrixWorld(true);
      rendered.camera = camera;
    }
  },
}));
vi.mock('../../cnc-viewer3d', () => ({
  buildStageFurniture: () => ({ object: new Group(), dispose: vi.fn() }),
  buildViewerContent: vi.fn(),
}));
vi.mock('../../relief-viewer/scene-lighting', () => ({
  applySceneLighting: () => ({ dispose: vi.fn() }),
}));
vi.mock('../../viewer3d/viewer3d-context', () => ({ disposeViewer3dRenderer: vi.fn() }));
vi.mock('./viewport-lines', () => ({
  loadViewportLinesAddons: async () => ({}),
  buildOverlayDrawable: vi.fn(),
}));

const frame: ViewportFrame = {
  originMm: { x: 20, y: 30 },
  widthMm: 160,
  heightMm: 90,
  thicknessMm: 12,
};
const handles: DesignViewportHandle[] = [];
beforeEach(() => {
  rendered.camera = null;
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  for (const handle of handles.splice(0)) handle.dispose();
  vi.unstubAllGlobals();
});

function setDimensions(canvas: HTMLCanvasElement, width: number, height: number): void {
  Object.defineProperties(canvas, {
    clientWidth: { configurable: true, value: width },
    clientHeight: { configurable: true, value: height },
  });
}

async function setup(width: number, height: number) {
  const canvas = document.createElement('canvas');
  setDimensions(canvas, width, height);
  const result = await createDesignViewportScene(canvas, frame);
  if (result.kind !== 'ok') throw new Error(result.reason);
  handles.push(result.handle);
  const camera = rendered.camera;
  if (camera === null) throw new Error('Expected the scene to render its real camera');
  return { canvas, camera, handle: result.handle };
}

function expectStockInside(camera: PerspectiveCamera): void {
  for (const x of [-frame.widthMm / 2, frame.widthMm / 2]) {
    for (const y of [-frame.heightMm / 2, frame.heightMm / 2]) {
      for (const z of [-frame.thicknessMm, 0]) {
        const projected = new Vector3(x, y, z).project(camera);
        expect(Math.abs(projected.x)).toBeLessThan(1);
        expect(Math.abs(projected.y)).toBeLessThan(1);
        expect(Math.abs(projected.z)).toBeLessThan(1);
      }
    }
  }
}

describe('Studio camera framing at the current viewport aspect', () => {
  it.each([
    [300, 600],
    [1200, 600],
  ])('fits the initial stock in a %s by %s viewport', async (width, height) => {
    const { camera } = await setup(width, height);
    expect(camera.aspect).toBe(width / height);
    expectStockInside(camera);
  });

  it('uses the latest resize aspect for Fit and each preset without changing its direction', async () => {
    const { canvas, camera, handle } = await setup(600, 600);
    for (const [width, height] of [
      [300, 600],
      [1200, 600],
      [250, 800],
    ]) {
      if (width === undefined || height === undefined) throw new Error('Missing test dimensions');
      setDimensions(canvas, width, height);
      const directionBeforeResize = camera.getWorldDirection(new Vector3());
      handle.resize(width, height);
      expect(
        camera.getWorldDirection(new Vector3()).distanceTo(directionBeforeResize),
      ).toBeLessThan(1e-10);
      for (const preset of CAMERA_PRESETS) {
        handle.setPreset(preset);
        expect(camera.aspect).toBe(width / height);
        expectStockInside(camera);
        const expected = viewDirection(preset);
        const direction = camera.getWorldDirection(new Vector3());
        expect(
          direction.distanceTo(new Vector3(-expected.x, -expected.y, -expected.z)),
        ).toBeLessThan(1e-10);
        expect(camera.up.toArray()).toEqual([0, 0, 1]);
      }
    }
  });
});
