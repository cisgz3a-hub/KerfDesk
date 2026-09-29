import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CameraIntrinsics,
  distortFisheye,
  fisheyeAngleLimit,
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
    expect(ray?.x).toBeCloseTo(0.4, 6);
    expect(ray?.y).toBeCloseTo(-0.25, 6);
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
          expect(ray?.x).toBeCloseTo(a, 5);
          expect(ray?.y).toBeCloseTo(b, 5);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// The lens a 300 mm target on a 400 mm bed produced before the fit dropped
// undetermined terms: theta_d(theta) peaks at about 0.674, at theta 0.747.
const FOLDING: FisheyeDistortion = [-0.041, 0.046, 0.581, -1.966];

function pixelAtDistortedRadius(radius: number): { x: number; y: number } {
  return { x: K.cx - (radius * K.fx) / Math.SQRT2, y: K.cy - (radius * K.fy) / Math.SQRT2 };
}

describe('fisheye inverse range', () => {
  it('finds the first turning point of a folding lens, and none for a monotonic one', () => {
    expect(fisheyeAngleLimit(FOLDING)).toBeCloseTo(0.747, 3);
    expect(fisheyeAngleLimit([0, 0, 0, 0])).toBe(Math.PI / 2);
    expect(fisheyeAngleLimit(D)).toBe(Math.PI / 2);
  });

  it('has no ray for a pixel past the widest radius the lens produces', () => {
    for (const radius of [0.69, 0.72, 0.8, 3]) {
      const pixel = pixelAtDistortedRadius(radius);
      expect(undistortPixel(pixel.x, pixel.y, K, FOLDING)).toBeNull();
    }
  });

  it('inverts every pixel inside that radius onto the rising side of the curve', () => {
    const limit = fisheyeAngleLimit(FOLDING);
    for (const theta of [0.05, 0.3, 0.6, 0.7, 0.74]) {
      const r = Math.tan(theta);
      const pixel = projectFisheye(-r / Math.SQRT2, -r / Math.SQRT2, K, FOLDING);
      const ray = undistortPixel(pixel.x, pixel.y, K, FOLDING);
      expect(Math.atan(Math.hypot(ray?.x ?? 0, ray?.y ?? 0))).toBeCloseTo(theta, 9);
      expect(Math.sign(ray?.x ?? 0)).toBe(-1);
      expect(theta).toBeLessThan(limit);
    }
  });

  it('has no ray for a pixel at or past a right angle from the axis', () => {
    // With no distortion theta_d = theta, so a radius of pi/2 or more is a ray
    // along or behind the image plane.
    const flat: FisheyeDistortion = [0, 0, 0, 0];
    expect(undistortPixel(K.cx + (Math.PI / 2) * K.fx, K.cy, K, flat)).toBeNull();
    expect(undistortPixel(K.cx + 1.6 * K.fx, K.cy, K, flat)).toBeNull();
    expect(undistortPixel(K.cx + 1.5 * K.fx, K.cy, K, flat)?.x).toBeCloseTo(Math.tan(1.5), 6);
  });

  it('has no ray for a pixel that is not a number', () => {
    expect(undistortPixel(Number.NaN, 10, K, D)).toBeNull();
  });
});
