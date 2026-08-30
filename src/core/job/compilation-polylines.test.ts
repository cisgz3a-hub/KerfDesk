import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath } from '../scene';
import { compilationPolylines } from './compilation-polylines';

describe('compilationPolylines', () => {
  it('keeps canonical geometry above the worker-routing threshold', () => {
    const segmentCount = 100_001;
    const path: ColoredPath = {
      color: '#000000',
      // Deliberately wrong compatibility geometry: output must never fall back
      // to this view merely because the canonical path is large.
      polylines: [
        {
          closed: false,
          points: [
            { x: 0, y: 0 },
            { x: -999, y: -999 },
          ],
        },
      ],
      curves: [
        {
          start: { x: 0, y: 0 },
          segments: Array.from({ length: segmentCount }, (_, index) => ({
            kind: 'line' as const,
            to: { x: index + 1, y: 0 },
          })),
          closed: false,
        },
      ],
    };

    const compiled = compilationPolylines(path, IDENTITY_TRANSFORM);

    expect(compiled).toHaveLength(1);
    expect(compiled[0]?.points).toHaveLength(segmentCount + 1);
    expect(compiled[0]?.points.at(-1)).toEqual({ x: segmentCount, y: 0 });
  });
});
