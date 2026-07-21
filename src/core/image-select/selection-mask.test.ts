import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  createEmptyMask,
  invertMask,
  isMaskEmpty,
  MASK_SOLID,
  maskBounds,
  selectAllMask,
} from './selection-mask';

describe('selection-mask basics', () => {
  it('empty and select-all masks report accordingly', () => {
    expect(isMaskEmpty(createEmptyMask(4, 4))).toBe(true);
    const all = selectAllMask(4, 4);
    expect(isMaskEmpty(all)).toBe(false);
    expect(maskBounds(all)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(maskBounds(createEmptyMask(4, 4))).toBeNull();
  });

  it('bounds are tight around scattered selected pixels', () => {
    const mask = createEmptyMask(10, 10);
    mask.alpha[3 * 10 + 2] = MASK_SOLID;
    mask.alpha[7 * 10 + 8] = MASK_SOLID;
    expect(maskBounds(mask)).toEqual({ x: 2, y: 3, width: 7, height: 5 });
  });

  it('invert is an involution and flips emptiness', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 12, maxLength: 12 }), (bytes) => {
        const mask = { width: 4, height: 3, alpha: Uint8Array.from(bytes) };
        const twice = invertMask(invertMask(mask));
        expect(Array.from(twice.alpha)).toEqual(Array.from(mask.alpha));
      }),
      { numRuns: 30 },
    );
    const inverted = invertMask(createEmptyMask(3, 3));
    expect(isMaskEmpty(inverted)).toBe(false);
    expect(maskBounds(inverted)).toEqual({ x: 0, y: 0, width: 3, height: 3 });
  });
});
