import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { viewer3dOrbitRadiansPerPixel } from '../viewer3d/viewer3d-controls';
import {
  applyCut3DCameraControl,
  CUT3D_CAMERA_FOV_DEG,
  cut3DCameraPose,
  initialCut3DCameraState,
  type Cut3DCameraState,
} from './cut3d-offscreen-camera';

const VIEWPORT = { widthPx: 640, heightPx: 480 };

describe('Cut 3D offscreen camera', () => {
  it('opens at the legacy Z-up three-quarter pose deterministically', () => {
    const first = initialCut3DCameraState(120, 80, 12);
    const second = initialCut3DCameraState(120, 80, 12);
    expect(second).toEqual(first);
    expect(cut3DCameraPose(first).position).toEqual([
      expect.closeTo(134.4),
      expect.closeTo(-134.4),
      expect.closeTo(115.2),
    ]);
  });

  it('applies ordered rotate, zoom, and pan messages reproducibly', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const controls = [
      { kind: 'rotate' as const, deltaX: 20, deltaY: -8 },
      { kind: 'zoom' as const, deltaY: 100 },
      { kind: 'pan' as const, deltaX: 12, deltaY: -7 },
    ];
    const reduce = () =>
      controls.reduce(
        (state, control) => applyCut3DCameraControl(state, control, VIEWPORT),
        initial,
      );
    expect(reduce()).toEqual(reduce());
    expect(reduce()).not.toEqual(initial);
  });

  it('keeps pitch and zoom inside finite camera bounds', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const pitched = applyCut3DCameraControl(
      initial,
      { kind: 'rotate', deltaX: 0, deltaY: 1_000_000 },
      VIEWPORT,
    );
    const zoomed = applyCut3DCameraControl(pitched, { kind: 'zoom', deltaY: -1_000_000 }, VIEWPORT);
    expect(pitched.pitchRad).toBeLessThan(Math.PI / 2);
    expect(zoomed.radiusMm).toBe(zoomed.minRadiusMm);
    expect(cut3DCameraPose(zoomed).position.every(Number.isFinite)).toBe(true);
  });

  it('orbits at the same speed per pixel as the orbit controls of every other view', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const turned = applyCut3DCameraControl(
      initial,
      { kind: 'rotate', deltaX: 30, deltaY: 0 },
      VIEWPORT,
    );
    expect(initial.yawRad - turned.yawRad).toBeCloseTo(30 * viewer3dOrbitRadiansPerPixel(480), 9);
  });

  it('zooms toward the cursor, keeping the point under it in place (ADR-426)', () => {
    const initial = initialCut3DCameraState(100, 60, 10);
    const cursor = { ndcX: 0.6, ndcY: -0.4 };
    const before = pointUnderCursor(initial, cursor);
    const zoomed = applyCut3DCameraControl(
      initial,
      { kind: 'zoom', deltaY: -300, cursor },
      VIEWPORT,
    );
    expect(zoomed.radiusMm).toBeLessThan(initial.radiusMm);
    const after = pointUnderCursor(zoomed, cursor);
    expect(after.distanceTo(before)).toBeLessThan(1e-6);

    // Without a cursor (a key press) the zoom stays on the target.
    const keyed = applyCut3DCameraControl(initial, { kind: 'zoom', deltaY: -300 }, VIEWPORT);
    expect([keyed.targetX, keyed.targetY, keyed.targetZ]).toEqual([0, 0, 0]);
  });
});

// Where the cursor's ray meets the plane through the target, facing the camera.
function pointUnderCursor(
  state: Cut3DCameraState,
  cursor: { readonly ndcX: number; readonly ndcY: number },
): Vector3 {
  const camera = new PerspectiveCamera(
    CUT3D_CAMERA_FOV_DEG,
    VIEWPORT.widthPx / VIEWPORT.heightPx,
    0.1,
    100_000,
  );
  const pose = cut3DCameraPose(state);
  camera.up.set(0, 0, 1);
  camera.position.set(...pose.position);
  camera.lookAt(...pose.target);
  camera.updateMatrixWorld();
  const target = new Vector3(...pose.target);
  const through = new Vector3(cursor.ndcX, cursor.ndcY, 0.5).unproject(camera);
  const ray = through.sub(camera.position).normalize();
  const normal = target.clone().sub(camera.position).normalize();
  const distance = target.clone().sub(camera.position).dot(normal) / ray.dot(normal);
  return camera.position.clone().addScaledVector(ray, distance);
}
