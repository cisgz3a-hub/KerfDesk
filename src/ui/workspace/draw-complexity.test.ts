import { describe, expect, it } from 'vitest';

import type { Polyline } from '../../core/scene';
import { countPolylineSegments, strideForSegmentBudget } from './draw-complexity';

describe('draw complexity helpers', () => {
  it('counts drawable line segments across polylines', () => {
    const polylines: Polyline[] = [
      { closed: false, points: [{ x: 0, y: 0 }] },
      {
        closed: false,
        points: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 2, y: 0 },
        ],
      },
      {
        closed: true,
        points: [
          { x: 0, y: 0 },
          { x: 0, y: 1 },
        ],
      },
    ];

    expect(countPolylineSegments(polylines)).toBe(3);
  });

  it('returns a sampling stride only after the segment budget is exceeded', () => {
    expect(strideForSegmentBudget(10_000)).toBe(1);
    expect(strideForSegmentBudget(10_001)).toBe(2);
    expect(strideForSegmentBudget(30_000)).toBe(3);
  });
});
