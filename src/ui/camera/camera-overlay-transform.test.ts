import { describe, expect, it } from 'vitest';
import type { Mat3 } from '../../core/camera';
import type { ViewTransform } from '../workspace/view-transform';
import { overlayMatrix3d } from './camera-overlay-transform';

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

// Apply the column-major 4×4 to [x, y, 0, 1] and perspective-divide.
function applyMatrix3d(m: ReadonlyArray<number>, x: number, y: number): { x: number; y: number } {
  const input = [x, y, 0, 1];
  const out = [0, 0, 0, 0];
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[row]! += m[col * 4 + row]! * input[col]!;
    }
  }
  return { x: out[0]! / out[3]!, y: out[1]! / out[3]! };
}

describe('overlayMatrix3d', () => {
  it('maps a camera pixel through identity calibration to the view-projected canvas pixel', () => {
    const view: ViewTransform = { scale: 2, offsetX: 10, offsetY: 20 };
    const m = overlayMatrix3d(IDENTITY, view);
    // identity homography -> bed mm == pixel; view: px = offset + mm·scale.
    expect(applyMatrix3d(m, 5, 7)).toEqual({ x: 10 + 5 * 2, y: 20 + 7 * 2 });
  });

  it('folds the canvas bitmap→CSS scale into the transform', () => {
    const view: ViewTransform = { scale: 2, offsetX: 10, offsetY: 20 };
    const cssScale = 0.5;
    const m = overlayMatrix3d(IDENTITY, view, cssScale);
    const mapped = applyMatrix3d(m, 5, 7);
    expect(mapped.x).toBeCloseTo((10 + 5 * 2) * 0.5, 9);
    expect(mapped.y).toBeCloseTo((20 + 7 * 2) * 0.5, 9);
  });

  it('composes a real calibration homography with the view', () => {
    const homography: Mat3 = [1.1, 0.05, 3, -0.04, 1.2, -2, 0.0003, 0.0002, 1];
    const view: ViewTransform = { scale: 1.5, offsetX: 40, offsetY: 12 };
    const m = overlayMatrix3d(homography, view);
    // Manually: bed = H(pixel); canvas = offset + bed·scale.
    const pixel = { x: 320, y: 240 };
    const w = homography[6] * pixel.x + homography[7] * pixel.y + homography[8];
    const bedX = (homography[0] * pixel.x + homography[1] * pixel.y + homography[2]) / w;
    const bedY = (homography[3] * pixel.x + homography[4] * pixel.y + homography[5]) / w;
    const mapped = applyMatrix3d(m, pixel.x, pixel.y);
    expect(mapped.x).toBeCloseTo(40 + bedX * 1.5, 6);
    expect(mapped.y).toBeCloseTo(12 + bedY * 1.5, 6);
  });
});
