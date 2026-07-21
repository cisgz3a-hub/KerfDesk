import { describe, expect, it } from 'vitest';
import { ellipseSelection, rectSelection } from './marquee';
import { maskBounds } from './selection-mask';

function count(alpha: Uint8Array): number {
  let selected = 0;
  for (const value of alpha) if (value > 0) selected += 1;
  return selected;
}

describe('rectSelection', () => {
  it('selects exactly the pixels whose centres lie in the rect', () => {
    const mask = rectSelection(8, 8, { x: 2, y: 2, width: 3, height: 3 });
    expect(count(mask.alpha)).toBe(9);
    expect(maskBounds(mask)).toEqual({ x: 2, y: 2, width: 3, height: 3 });
  });

  it('clamps to the document and drops zero-size rects', () => {
    const clipped = rectSelection(4, 4, { x: -2, y: -2, width: 4, height: 4 });
    expect(maskBounds(clipped)).toEqual({ x: 0, y: 0, width: 2, height: 2 });
    expect(count(rectSelection(4, 4, { x: 1, y: 1, width: 0, height: 3 }).alpha)).toBe(0);
  });
});

describe('ellipseSelection', () => {
  it('matches the analytic pixel-centre disc count and is symmetric', () => {
    const mask = ellipseSelection(8, 8, { x: 1, y: 1, width: 6, height: 6 });
    expect(count(mask.alpha)).toBe(32);
    // 4-fold symmetry about the centre (4, 4).
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        const mirrored = mask.alpha[(7 - y) * 8 + (7 - x)];
        expect(mask.alpha[y * 8 + x]).toBe(mirrored);
      }
    }
  });

  it('a zero-size ellipse selects nothing', () => {
    expect(count(ellipseSelection(6, 6, { x: 2, y: 2, width: 0, height: 4 }).alpha)).toBe(0);
  });
});
