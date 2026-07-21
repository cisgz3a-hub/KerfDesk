import { describe, expect, it } from 'vitest';
import { polygonSelection } from './lasso';
import { maskBounds } from './selection-mask';

function count(alpha: Uint8Array): number {
  let selected = 0;
  for (const value of alpha) if (value > 0) selected += 1;
  return selected;
}

describe('polygonSelection', () => {
  it('fills an axis-aligned square exactly', () => {
    const mask = polygonSelection(8, 8, [
      { x: 1, y: 1 },
      { x: 5, y: 1 },
      { x: 5, y: 5 },
      { x: 1, y: 5 },
    ]);
    expect(count(mask.alpha)).toBe(16);
    expect(maskBounds(mask)).toEqual({ x: 1, y: 1, width: 4, height: 4 });
  });

  it('keeps the even-odd rule on a self-crossing bowtie', () => {
    const mask = polygonSelection(8, 8, [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 0, y: 6 },
      { x: 6, y: 6 },
    ]);
    // Top scan row of the upper triangle spans x in [0.5, 5.5) -> 6 pixels...
    let topRow = 0;
    for (let x = 0; x < 8; x += 1) topRow += (mask.alpha[x] ?? 0) > 0 ? 1 : 0;
    expect(topRow).toBe(6);
    // ...while the pinch row just above the crossing narrows to 2 pixels.
    let pinchRow = 0;
    for (let x = 0; x < 8; x += 1) pinchRow += (mask.alpha[2 * 8 + x] ?? 0) > 0 ? 1 : 0;
    expect(pinchRow).toBe(2);
  });

  it('needs at least three points', () => {
    expect(
      count(
        polygonSelection(6, 6, [
          { x: 0, y: 0 },
          { x: 5, y: 5 },
        ]).alpha,
      ),
    ).toBe(0);
  });
});
