import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CameraIntrinsics,
  distortFisheye,
  type FisheyeDistortion,
  projectFisheye,
  undistortPixel,
} from './fisheye';

const K: CameraIntrinsics = { fx: 800, fy: 800, cx: 640, cy: 360 };
const D: FisheyeDistortion = [0.02, -0.005, 0.001, -0.0002];

describe('fisheye', () => {
  it('maps the optical axis to the principal point', () => {
    expect(distortFisheye(0, 0, D)).toEqual({ x: 0, y: 0 });
    const pixel = projectFisheye(0, 0, K, D);
    expect(pixel.x).toBeCloseTo(K.cx, 9);
    expect(pixel.y).toBeCloseTo(K.cy, 9);
  });

  it('round-trips a ray through project then undistort', () => {
    const pixel = projectFisheye(0.4, -0.25, K, D);
    const ray = undistortPixel(pixel.x, pixel.y, K, D);
    expect(ray.x).toBeCloseTo(0.4, 6);
    expect(ray.y).toBeCloseTo(-0.25, 6);
  });

  it('preserves direction — only the radius is bent', () => {
    const distorted = distortFisheye(0.6, 0.3, [0, 0, 0, 0]);
    expect(distorted.x / distorted.y).toBeCloseTo(0.6 / 0.3, 9);
  });

  it('compresses wide angles even with zero distortion (equidistant projection)', () => {
    // With D=0, theta_d = theta = atan(r) < r, so the normalized radius shrinks.
    const distorted = distortFisheye(2, 0, [0, 0, 0, 0]);
    expect(Math.hypot(distorted.x, distorted.y)).toBeCloseTo(Math.atan(2), 9);
    expect(Math.hypot(distorted.x, distorted.y)).toBeLessThan(2);
  });

  it('round-trips arbitrary rays and distortions (property)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -1, max: 1, noNaN: true }),
        fc.double({ min: -0.05, max: 0.05, noNaN: true }),
        fc.double({ min: -0.02, max: 0.02, noNaN: true }),
        (a, b, k1, k2) => {
          const d: FisheyeDistortion = [k1, k2, 0, 0];
          const pixel = projectFisheye(a, b, K, d);
          const ray = undistortPixel(pixel.x, pixel.y, K, d);
          expect(ray.x).toBeCloseTo(a, 5);
          expect(ray.y).toBeCloseTo(b, 5);
        },
      ),
      { numRuns: 100 },
    );
  });
});
