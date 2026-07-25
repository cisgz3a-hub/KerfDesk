import { describe, expect, it } from 'vitest';
import { arcSweepAngle, ijArcCenter, rArcGeometry } from './arc-solve';

describe('ijArcCenter', () => {
  it('offsets incrementally from the start point, scaled by units', () => {
    expect(ijArcCenter({ x: 10, y: 5 }, 2, -1, 1)).toEqual({ x: 12, y: 4 });
    expect(ijArcCenter({ x: 0, y: 0 }, 1, undefined, 25.4)).toEqual({ x: 25.4, y: 0 });
  });
});

describe('rArcGeometry', () => {
  it('solves the minor-arc center for positive R and the major side for negative R', () => {
    const minor = rArcGeometry({ x: 0, y: 0 }, { x: 10, y: 10 }, 10, false, 1);
    expect(minor).not.toBeNull();
    expect(minor?.center.x).toBeCloseTo(0, 9);
    expect(minor?.center.y).toBeCloseTo(10, 9);

    const major = rArcGeometry({ x: 0, y: 0 }, { x: 10, y: 10 }, -10, false, 1);
    expect(major?.center.x).toBeCloseTo(10, 9);
    expect(major?.center.y).toBeCloseTo(0, 9);
  });

  it('returns null for a zero-length chord; too-small radii clamp onto the chord with a negative gap', () => {
    expect(rArcGeometry({ x: 1, y: 1 }, { x: 1, y: 1 }, 5, true, 1)).toBeNull();

    const tooSmall = rArcGeometry({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, true, 1);
    expect(tooSmall).not.toBeNull();
    expect(tooSmall?.halfChordGapSq ?? 0).toBeLessThan(0);
    expect(tooSmall?.center.x).toBeCloseTo(5, 9);
    expect(tooSmall?.center.y).toBeCloseTo(0, 9);
  });
});

describe('arcSweepAngle', () => {
  it('signs the sweep by direction', () => {
    expect(arcSweepAngle(0, Math.PI / 2, false, false)).toBeCloseTo(Math.PI / 2, 12);
    expect(arcSweepAngle(0, Math.PI / 2, true, false)).toBeCloseTo(Math.PI / 2 - 2 * Math.PI, 12);
  });

  it('emits a full turn when the caller flags coincident endpoints', () => {
    expect(arcSweepAngle(1.2, 1.2, true, true)).toBeCloseTo(-2 * Math.PI, 12);
    expect(arcSweepAngle(1.2, 1.2, false, true)).toBeCloseTo(2 * Math.PI, 12);
  });
});
