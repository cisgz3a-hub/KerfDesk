import { describe, expect, it } from 'vitest';
import { makeRidgeSnapper, type SubpixelField } from './edge-subpixel';

const WIDTH = 24;
const HEIGHT = 8;

// A vertical edge whose magnitude ridge is an exact parabola peaking at cell
// coordinate `peakX` — the parabolic fit must recover it exactly.
function verticalRidgeField(peakX: number): SubpixelField {
  const gradMag = new Float32Array(WIDTH * HEIGHT);
  const gradX = new Float32Array(WIDTH * HEIGHT);
  const gradY = new Float32Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const i = y * WIDTH + x;
      gradMag[i] = Math.max(0, 30 - (x - peakX) * (x - peakX));
      gradX[i] = 1;
      gradY[i] = 0;
    }
  }
  return { gradMag, gradX, gradY, width: WIDTH, height: HEIGHT };
}

describe('makeRidgeSnapper', () => {
  it('moves a lattice vertex onto the sub-pixel magnitude peak', () => {
    const snap = makeRidgeSnapper(verticalRidgeField(10.3));
    // Mask picked cell x=10 → point (10.5, 4.5); the true ridge is at 10.3
    // in cell coordinates → point x = 10.8.
    const snapped = snap({ x: 10.5, y: 4.5 });
    expect(snapped.x).toBeCloseTo(10.8, 5);
    expect(snapped.y).toBeCloseTo(4.5, 5);
  });

  it('clamps the shift well below one pixel even when the peak is far away', () => {
    const snap = makeRidgeSnapper(verticalRidgeField(14));
    const snapped = snap({ x: 10.5, y: 4.5 });
    expect(Math.abs(snapped.x - 10.5)).toBeLessThanOrEqual(0.6);
  });

  it('keeps the vertex when the gradient vanishes', () => {
    const field = verticalRidgeField(10.3);
    field.gradX.fill(0);
    const snap = makeRidgeSnapper(field);
    expect(snap({ x: 10.5, y: 4.5 })).toEqual({ x: 10.5, y: 4.5 });
  });

  it('keeps the vertex on a flat magnitude plateau (no ridge crossing)', () => {
    const gradMag = new Float32Array(WIDTH * HEIGHT).fill(5);
    const gradX = new Float32Array(WIDTH * HEIGHT).fill(1);
    const gradY = new Float32Array(WIDTH * HEIGHT);
    const snap = makeRidgeSnapper({ gradMag, gradX, gradY, width: WIDTH, height: HEIGHT });
    expect(snap({ x: 10.5, y: 4.5 })).toEqual({ x: 10.5, y: 4.5 });
  });
});
