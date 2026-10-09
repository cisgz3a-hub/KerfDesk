// Independent physical oracle for the ID source-plane tier; GPU qualification
// still requires the fixed admitted pointers and actual linked shader captures.
import { describe, expect, it } from 'vitest';
import { writePickSourceAxis } from './line-pick-source-axis';

type V = readonly [number, number, number];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const subtract = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V, b: V): V => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const axes = (a: V, b: V): V => {
  const target = new Float32Array(3);
  writePickSourceAxis(target, 0, ...a, ...b);
  return [target[0] ?? 0, target[1] ?? 0, target[2] ?? 0];
};
// Cross-product construction is independent of the shader's projection formula.
const facing = (direction: V, ray: V): V => cross(direction, cross(ray, direction));

function assertPlane(
  start: V,
  end: V,
  camera: V,
  perspective: boolean,
  orthographicRay: V = [0, 0, 1],
): V {
  const direction = axes(start, end);
  const delta = subtract(start, camera);
  const normal = facing(direction, perspective ? delta : orthographicRay);
  const span = subtract(end, start);
  const membership = Math.abs(dot(normal, span));
  const localScale = Math.max(1, Math.hypot(...normal) * Math.hypot(...span));
  expect(membership).toBeLessThanOrEqual(8 * Number.EPSILON * localScale);
  expect(Math.hypot(...normal)).toBeGreaterThan(0);
  expect(facing(axes(end, start), perspective ? delta : orthographicRay)).toEqual(normal);
  return normal;
}

describe('independent camera-facing source-plane algebra', () => {
  it.each([false, true])(
    'contains the admitted ramp and its exact reverse, perspective=%s',
    (perspective) => {
      // Object-space orthographic direction is the captured normalMatrix's last row.
      const normal = assertPlane(
        [0, 0, -25],
        [100, 0, 25],
        [100, -100, 25],
        perspective,
        [0.4364357888698578, -0.8728715777397156, 0.2182178944349289],
      );
      // For perspective the camera-to-anchor ray projects exactly to the Y axis.
      if (perspective) expect([Math.abs(normal[0]), Math.abs(normal[2])]).toEqual([0, 0]);
    },
  );

  it.each([false, true])(
    'also represents a flat source with a general XY axis, perspective=%s',
    (perspective) => {
      assertPlane([0, 0, 0], [100, 0, 0], [50, -100, 0], perspective, [0, -1, 0]);
      assertPlane([20, 30, 4], [36, 38, 4], [55, -70, 4], perspective, [1, -2, 0]);
    },
  );

  it.each([false, true])(
    'contains genuine vertical XYZ without flattening Z, perspective=%s',
    (perspective) => {
      assertPlane([0, 0, 0], [0, 0, 100], [150, 0, 125], perspective, [150, 0, 75]);
    },
  );
  it('identifies camera-on-axis and orthographic view-axis collapse as unresolved planes', () => {
    const direction = axes([0, 0, 0], [100, 0, 50]);
    expect(facing(direction, [200, 0, 100])).toEqual([0, 0, 0]);
    expect(facing(axes([0, 0, 0], [0, 0, 100]), [0, 0, 1])).toEqual([0, 0, 0]);
  });
});
