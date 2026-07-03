import { describe, expect, it } from 'vitest';
import { rectifyImage, type RgbaImage } from './cpu-rectify';
import { type CameraIntrinsics, type FisheyeDistortion, undistortPixel } from './fisheye';

// Small frame with a short focal so the barrel distortion is pronounced across it.
const W = 80;
const H = 60;
const K: CameraIntrinsics = { fx: 55, fy: 55, cx: W / 2, cy: H / 2 };
const D: FisheyeDistortion = [0.12, 0.03, 0, 0];

// The true (undistorted) scene: a smooth horizontal gradient. Smooth so bilinear
// resampling is faithful; a hard edge would alias.
function sceneValue(xUndistorted: number): number {
  return (255 * xUndistorted) / (W - 1);
}

// Build the fisheye camera's view of that scene: for each source pixel, find the
// pinhole ray it sees (undistort), map it to the undistorted-scene pixel, sample.
function distortedSource(): RgbaImage {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const ray = undistortPixel(x, y, K, D);
      const xScene = K.fx * ray.x + K.cx;
      const value = xScene >= 0 && xScene <= W - 1 ? sceneValue(xScene) : 0;
      const offset = (y * W + x) * 4;
      data[offset] = value;
      data[offset + 1] = value;
      data[offset + 2] = value;
      data[offset + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

describe('rectifyImage (de-fisheye reconstructs the scene)', () => {
  it('straightens a barrel-distorted gradient back to the true scene', () => {
    const source = distortedSource();
    const out = rectifyImage(source, {
      width: W,
      height: H,
      outputK: K,
      sourceK: K,
      distortion: D,
    });
    // Over an interior band (away from the frame edges where the rectified field
    // falls outside the source), the recovered value must match the true scene.
    let maxError = 0;
    let checked = 0;
    for (let y = 12; y < H - 12; y += 1) {
      for (let x = 16; x < W - 16; x += 1) {
        const expected = sceneValue(x);
        const got = out.data[(y * W + x) * 4] ?? -1;
        maxError = Math.max(maxError, Math.abs(got - expected));
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
    // A few grey levels of slack for bilinear resampling + 8-bit quantisation.
    expect(maxError).toBeLessThan(6);
  });

  it('marks out-of-frame output pixels transparent', () => {
    // A tiny source cannot fill a much larger rectified output; corners fall outside.
    const source: RgbaImage = {
      data: new Uint8ClampedArray(4 * 4 * 4).fill(200),
      width: 4,
      height: 4,
    };
    const out = rectifyImage(source, {
      width: 40,
      height: 40,
      outputK: { fx: 10, fy: 10, cx: 20, cy: 20 },
      sourceK: K,
      distortion: D,
    });
    expect(out.data[3]).toBe(0); // top-left corner alpha
    expect(out.data[(39 * 40 + 39) * 4 + 3]).toBe(0); // bottom-right corner alpha
  });

  it('samples a point landing exactly on the last source row/column without a seam', () => {
    // Output pixel (0,0) maps to source pixel (1,1) — the last valid index of a 2x2.
    // The high bilinear tap (x0+1, y0+1) is out of range but its weight is 0, so the
    // pixel is valid: an over-eager edge guard would wrongly drop it to transparent.
    const source: RgbaImage = { data: new Uint8ClampedArray(2 * 2 * 4), width: 2, height: 2 };
    const corner = (1 * 2 + 1) * 4;
    source.data[corner] = 10;
    source.data[corner + 1] = 20;
    source.data[corner + 2] = 30;
    source.data[corner + 3] = 255;
    const out = rectifyImage(source, {
      width: 1,
      height: 1,
      outputK: { fx: 1, fy: 1, cx: 0, cy: 0 },
      sourceK: { fx: 1, fy: 1, cx: 1, cy: 1 },
      distortion: [0, 0, 0, 0],
    });
    expect(out.data[3]).toBe(255); // opaque — not a transparent seam
    expect([out.data[0], out.data[1], out.data[2]]).toEqual([10, 20, 30]);
  });
});
