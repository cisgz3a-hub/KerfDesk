import { describe, expect, it } from 'vitest';
import type { Mat3 } from '../homography';
import { rectifiedRegion } from './rectify-photo';

const REFERENCE = { widthMm: 210, heightMm: 297 };

describe('rectifiedRegion horizon clamps', () => {
  it('uses clamp extents for every side touched by a corner behind the horizon', () => {
    const toMm: Mat3 = [1, 0, 0, 0, 1, 0, 0.02, 0.02, -1];
    const result = rectifiedRegion(100, 100, toMm, REFERENCE);
    expect(result.region).toEqual({
      x: -1000,
      y: -1000,
      width: 1100,
      height: 1100,
    });
    expect(Object.values(result.region).every(Number.isFinite)).toBe(true);
    expect(result.pixelsPerMm).toBeGreaterThan(0);
  });

  it('returns the full clamp box when no image corner is in front of the horizon', () => {
    const toMm: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, -1];
    const result = rectifiedRegion(100, 100, toMm, REFERENCE);
    expect(result.region).toEqual({
      x: -1000,
      y: -1000,
      width: 2210,
      height: 2297,
    });
    expect([...Object.values(result.region), result.pixelsPerMm].every(Number.isFinite)).toBe(true);
  });
});
