import { describe, expect, it } from 'vitest';
import { formatGcodeCoordinateMm, hasGcodeXyMotionAtEmitPrecision } from './coordinate-format';

describe('G-code coordinate formatting', () => {
  it('retains a short move that crosses a three-decimal coordinate boundary', () => {
    expect(hasGcodeXyMotionAtEmitPrecision({ x: 10.0004, y: 4 }, { x: 10.0012, y: 4 })).toBe(true);
  });

  it('drops a diagonal move whose endpoints format to the same XY cell', () => {
    const delta = 0.001 / Math.sqrt(2);
    expect(
      hasGcodeXyMotionAtEmitPrecision(
        { x: 10.0006, y: 4.0006 },
        { x: 10.0006 + delta, y: 4.0006 + delta },
      ),
    ).toBe(false);
  });

  it('preserves the emitter precision while canonicalizing signed zero', () => {
    expect(formatGcodeCoordinateMm(1 / 3)).toBe('0.333');
    expect(formatGcodeCoordinateMm(-0.0004)).toBe('0.000');
    expect(hasGcodeXyMotionAtEmitPrecision({ x: -0.0004, y: 4 }, { x: 0.0004, y: 4 })).toBe(false);
  });
});
