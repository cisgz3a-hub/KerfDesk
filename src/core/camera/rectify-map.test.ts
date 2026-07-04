import { describe, expect, it } from 'vitest';
import { type CameraIntrinsics, type FisheyeDistortion, undistortPixel } from './fisheye';
import { buildRectifyMap, rectifySamplePoint } from './rectify-map';

const K: CameraIntrinsics = { fx: 900, fy: 890, cx: 960, cy: 540 };
const D: FisheyeDistortion = [0.08, -0.01, 0.004, -0.0005];

describe('rectifySamplePoint', () => {
  it('maps the output principal point to the source principal point', () => {
    const sample = rectifySamplePoint({ x: K.cx, y: K.cy }, K, K, D);
    expect(sample.x).toBeCloseTo(K.cx, 9);
    expect(sample.y).toBeCloseTo(K.cy, 9);
  });

  it('round-trips: undistorting the sampled point recovers the output pinhole ray', () => {
    // The sampled source pixel, run back through the inverse model, must yield the
    // exact pinhole ray the output pixel represents — proves the rectify direction.
    const out = { x: 1300, y: 760 };
    const sample = rectifySamplePoint(out, K, K, D);
    const ray = undistortPixel(sample.x, sample.y, K, D);
    expect(ray.x).toBeCloseTo((out.x - K.cx) / K.fx, 6);
    expect(ray.y).toBeCloseTo((out.y - K.cy) / K.fy, 6);
  });

  it('pulls a corner output pixel inward under barrel distortion', () => {
    // A rectified corner ray samples a source pixel closer to the centre — the
    // fisheye compresses wide angles, so removing it expands outward (sample inward).
    const corner = { x: 1900, y: 1060 };
    const sample = rectifySamplePoint(corner, K, K, D);
    const outRadius = Math.hypot(corner.x - K.cx, corner.y - K.cy);
    const sampleRadius = Math.hypot(sample.x - K.cx, sample.y - K.cy);
    expect(sampleRadius).toBeLessThan(outRadius);
  });
});

describe('buildRectifyMap', () => {
  it('fills (u, v) source coordinates for every output pixel', () => {
    const width = 8;
    const height = 6;
    const map = buildRectifyMap(width, height, K, K, D);
    expect(map).toHaveLength(width * height * 2);
    // Spot-check that pixel (3,2) matches the per-pixel function, at float32
    // precision (the map is a Float32Array — the GPU texture upload format).
    const direct = rectifySamplePoint({ x: 3, y: 2 }, K, K, D);
    const index = (2 * width + 3) * 2;
    expect(map[index]).toBe(Math.fround(direct.x));
    expect(map[index + 1]).toBe(Math.fround(direct.y));
  });
});
