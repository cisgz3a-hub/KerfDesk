import { describe, expect, it } from 'vitest';
import { applyTransform, IDENTITY_TRANSFORM } from '../scene';
import { alignNodePoints, nodeAlignAxis, segmentAlignRotationDeg } from './node-align';

describe('node align', () => {
  it('lines nodes up along the axis they spread less across', () => {
    const row = [
      { x: 0, y: 1 },
      { x: 10, y: -1 },
      { x: 20, y: 0.5 },
    ];
    expect(nodeAlignAxis(row)).toBe('horizontal');
    expect(alignNodePoints(row, { x: 20, y: 0.5 }, 'horizontal')).toEqual([
      { x: 0, y: 0.5 },
      { x: 10, y: 0.5 },
      { x: 20, y: 0.5 },
    ]);
    const column = [
      { x: 3, y: 0 },
      { x: 2, y: 30 },
    ];
    expect(nodeAlignAxis(column)).toBe('vertical');
    expect(alignNodePoints(column, { x: 3, y: 0 }, 'vertical')).toEqual([
      { x: 3, y: 0 },
      { x: 3, y: 30 },
    ]);
    expect(nodeAlignAxis([{ x: 1, y: 1 }])).toBeNull();
  });

  it('finds the rotation that lays a segment on the nearest 45 degree line', () => {
    expect(segmentAlignRotationDeg({ x: 0, y: 0 }, { x: 10, y: 1 })).toBeCloseTo(
      -(Math.atan2(1, 10) * 180) / Math.PI,
      9,
    );
    expect(segmentAlignRotationDeg({ x: 0, y: 0 }, { x: 10, y: 9 })).toBeCloseTo(
      45 - (Math.atan2(9, 10) * 180) / Math.PI,
      9,
    );
    expect(segmentAlignRotationDeg({ x: 0, y: 0 }, { x: 0, y: 10 })).toBeNull();
    expect(segmentAlignRotationDeg({ x: 2, y: 2 }, { x: 2, y: 2 })).toBeNull();
  });

  it('turns in the same sense as an object rotation', () => {
    const from = { x: 0, y: 0 };
    const to = { x: 10, y: 3 };
    const delta = segmentAlignRotationDeg(from, to) as number;
    const rotated = applyTransform(to, { ...IDENTITY_TRANSFORM, rotationDeg: delta });
    expect(rotated.y).toBeCloseTo(0, 9);
    expect(rotated.x).toBeGreaterThan(0);
  });
});
