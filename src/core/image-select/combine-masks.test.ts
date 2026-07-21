import { describe, expect, it } from 'vitest';
import { combineMasks } from './combine-masks';
import { rectSelection } from './marquee';
import { maskBounds } from './selection-mask';

function count(alpha: Uint8Array): number {
  let selected = 0;
  for (const value of alpha) if (value > 0) selected += 1;
  return selected;
}

describe('combineMasks', () => {
  const left = rectSelection(10, 10, { x: 1, y: 1, width: 4, height: 4 });
  const right = rectSelection(10, 10, { x: 3, y: 3, width: 4, height: 4 });

  it('replace and null-base return the incoming mask', () => {
    expect(combineMasks(left, right, 'replace')).toBe(right);
    expect(combineMasks(null, right, 'add')).toBe(right);
  });

  it('add unions the two areas', () => {
    const union = combineMasks(left, right, 'add');
    // 16 + 16 - 4 overlapping pixels.
    expect(count(union.alpha)).toBe(28);
    expect(maskBounds(union)).toEqual({ x: 1, y: 1, width: 6, height: 6 });
  });

  it('subtract removes the overlap from the base', () => {
    const cut = combineMasks(left, right, 'subtract');
    expect(count(cut.alpha)).toBe(12);
    // The overlapping corner (3..4 × 3..4) is gone.
    expect(cut.alpha[3 * 10 + 3]).toBe(0);
    expect(cut.alpha[1 * 10 + 1]).toBeGreaterThan(0);
  });

  it('intersect keeps only the overlap', () => {
    const overlap = combineMasks(left, right, 'intersect');
    expect(count(overlap.alpha)).toBe(4);
    expect(maskBounds(overlap)).toEqual({ x: 3, y: 3, width: 2, height: 2 });
  });
});
