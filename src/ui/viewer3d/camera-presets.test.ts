import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import type { AxisBounds } from '../../core/gcode-view';
import {
  boundsCenter,
  boundsExtent,
  CAMERA_PRESETS,
  cameraPlacement,
  projectionForView,
  VIEWER3D_VIEWS,
  type CameraPreset,
} from './camera-presets';
import { orthographicHalfHeight } from './camera-projection';
import { tweenPose } from './camera-tween';

// A 100 x 60 x 10 job centred on (50, 30, -5).
const BOUNDS: AxisBounds = { minX: 0, maxX: 100, minY: 0, maxY: 60, minZ: -10, maxZ: 0 };

describe('cameraPlacement', () => {
  it('fits every job corner in wide and narrow viewports, including elevated Z', () => {
    const bounds = { ...BOUNDS, minZ: 100, maxZ: 140 };
    for (const aspect of [0.4, 1, 2]) {
      for (const preset of CAMERA_PRESETS) {
        const view = cameraPlacement(preset, bounds, aspect);
        const camera = new PerspectiveCamera(40, aspect, 0.1, 100_000);
        camera.position.set(view.position.x, view.position.y, view.position.z);
        camera.up.set(view.up.x, view.up.y, view.up.z);
        camera.lookAt(view.target.x, view.target.y, view.target.z);
        camera.updateMatrixWorld();
        for (const x of [bounds.minX, bounds.maxX]) {
          for (const y of [bounds.minY, bounds.maxY]) {
            for (const z of [bounds.minZ, bounds.maxZ]) {
              const projected = new Vector3(x, y, z).project(camera);
              expect(Math.abs(projected.x)).toBeLessThan(1);
              expect(Math.abs(projected.y)).toBeLessThan(1);
            }
          }
        }
      }
    }
  });
  it('always targets the centre of the job', () => {
    for (const preset of CAMERA_PRESETS) {
      expect(cameraPlacement(preset, BOUNDS).target).toEqual({ x: 50, y: 30, z: -5 });
    }
  });

  it('places Top above the job, looking down to within a tenth of a degree, still Z-up', () => {
    const view = cameraPlacement('top', BOUNDS);
    const offset = new Vector3(
      view.position.x - view.target.x,
      view.position.y - view.target.y,
      view.position.z - view.target.z,
    );
    expect(view.position.x).toBeCloseTo(50, 6);
    expect(view.position.z).toBeGreaterThan(0);
    // A hair toward the operator (-Y) keeps the Z-up orbit from degenerating,
    // so +Y still reads as "up the screen" and the orbit never flips.
    expect(view.position.y).toBeLessThan(30);
    expect(offset.angleTo(new Vector3(0, 0, 1))).toBeLessThan((0.1 * Math.PI) / 180);
    expect(view.up).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('places Front on -Y and Right on +X, both Z-up', () => {
    const front = cameraPlacement('front', BOUNDS);
    expect(front.position.y).toBeLessThan(front.target.y);
    expect(front.position.x).toBeCloseTo(50, 6);
    expect(front.up).toEqual({ x: 0, y: 0, z: 1 });

    const right = cameraPlacement('right', BOUNDS);
    expect(right.position.x).toBeGreaterThan(right.target.x);
    expect(right.position.y).toBeCloseTo(30, 6);
    expect(right.up).toEqual({ x: 0, y: 0, z: 1 });
  });

  it('places Iso off-axis on all three axes', () => {
    const iso = cameraPlacement('iso', BOUNDS);
    expect(iso.position.x).toBeGreaterThan(iso.target.x);
    expect(iso.position.y).toBeLessThan(iso.target.y);
    expect(iso.position.z).toBeGreaterThan(iso.target.z);
  });

  it('backs off further for a bigger job', () => {
    const small = cameraPlacement('front', BOUNDS);
    const big = cameraPlacement('front', { ...BOUNDS, maxX: 1000 });
    const reach = (view: { position: { y: number }; target: { y: number } }): number =>
      Math.abs(view.target.y - view.position.y);
    expect(reach(big)).toBeGreaterThan(reach(small));
  });

  it('keeps the camera off a straight-line job seen end-on, in every view', () => {
    const lines: ReadonlyArray<AxisBounds> = [
      { minX: 0, maxX: 100, minY: 30, maxY: 30, minZ: 0, maxZ: 0 },
      { minX: 50, maxX: 50, minY: 0, maxY: 100, minZ: 0, maxZ: 0 },
      // A single deep plunge: a drilled hole seen from above.
      { minX: 50, maxX: 50, minY: 30, maxY: 30, minZ: -40, maxZ: 0 },
    ];
    const start = cameraPlacement('iso', lines[0] ?? null);
    for (const bounds of lines) {
      for (const view of VIEWER3D_VIEWS) {
        for (const aspect of [0.4, 1, 2]) {
          const placement = cameraPlacement(view, bounds, aspect, projectionForView(view));
          const distance = Math.hypot(
            placement.position.x - placement.target.x,
            placement.position.y - placement.target.y,
            placement.position.z - placement.target.z,
          );
          // At least the minimum 10 mm view either side of the target.
          expect(orthographicHalfHeight(distance, 40) * Math.min(1, aspect)).toBeGreaterThan(5);
          const middle = tweenPose(start, placement, 0.5).position;
          expect([middle.x, middle.y, middle.z].every(Number.isFinite)).toBe(true);
        }
      }
    }
  });

  it('still produces a usable view with no bounds at all', () => {
    for (const preset of CAMERA_PRESETS as ReadonlyArray<CameraPreset>) {
      const view = cameraPlacement(preset, null);
      expect(view.target).toEqual({ x: 0, y: 0, z: 0 });
      const distance = Math.hypot(view.position.x, view.position.y, view.position.z);
      expect(distance).toBeGreaterThan(0);
      expect(Number.isFinite(distance)).toBe(true);
    }
  });
});

describe('boundsCenter and boundsExtent', () => {
  it('describe the job, with sane fallbacks', () => {
    expect(boundsCenter(BOUNDS)).toEqual({ x: 50, y: 30, z: -5 });
    expect(boundsExtent(BOUNDS)).toBe(100);
    expect(boundsCenter(null)).toEqual({ x: 0, y: 0, z: 0 });
    expect(boundsExtent(null)).toBeGreaterThan(0);
    // A degenerate (zero-size) job must not collapse the camera onto it.
    expect(boundsExtent({ minX: 5, maxX: 5, minY: 5, maxY: 5, minZ: 0, maxZ: 0 })).toBeGreaterThan(
      0,
    );
  });
});
