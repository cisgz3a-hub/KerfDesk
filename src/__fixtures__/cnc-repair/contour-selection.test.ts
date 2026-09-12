import { describe, expect, it } from 'vitest';
import { selectLineArtContours } from '../../core/cnc/line-art-contours';
import type { Polyline } from '../../core/scene';
import { compiled, square } from './motion-fixture';

const diamond: Polyline = {
  closed: true,
  points: [
    { x: 0.2, y: 10 },
    { x: 10, y: 0.2 },
    { x: 19.8, y: 10 },
    { x: 10, y: 19.8 },
  ],
};

describe('S6: true boundary proximity decides traced pairs', () => {
  it.each(['inner', 'outer'] as const)(
    'retains the square/diamond genuine contours for %s',
    (side) => {
      const outer = square(0, 20);
      // Corner-to-diamond distance is 10.2 / sqrt(2), despite 0.2 mm bbox gaps.
      expect(10.2 / Math.sqrt(2)).toBeGreaterThan(2);
      expect(selectLineArtContours([outer, diamond], side, 2)).toEqual([outer, diamond]);
      const { job } = compiled(
        { cutType: 'profile-on-path', depthMm: 1, depthPerPassMm: 1, lineArtContours: side },
        [outer, diamond],
        2,
      );
      expect(job.groups[0]?.kind === 'cnc' ? job.groups[0].passes : []).toHaveLength(2);
    },
  );

  it('preserves a real concave band even when every outer vertex is near the inner boundary', () => {
    const outer = square(0, 20);
    const indented: Polyline = {
      closed: true,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 6, y: 0.2 },
        { x: 6, y: 8 },
        { x: 14, y: 8 },
        { x: 14, y: 0.2 },
        { x: 19.8, y: 0.2 },
        { x: 19.8, y: 19.8 },
        { x: 0.2, y: 19.8 },
      ],
    };
    // The outer edge midpoint (10,0) is 4 mm from the notch walls;
    // checking either bounding boxes or just outer vertices misses it.
    expect(selectLineArtContours([outer, indented], 'inner', 2)).toEqual([outer, indented]);
  });

  it.each(['inner', 'outer'] as const)(
    'still selects the requested %s edge of a uniform thin band',
    (side) => {
      const outer = square(0, 20);
      const inner = square(0.2, 19.8);
      expect(selectLineArtContours([outer, inner], side, 2)).toEqual([
        side === 'inner' ? inner : outer,
      ]);
    },
  );

  it('checks the spaces between vertices on both boundaries', () => {
    const outer = square(0, 20);
    const inner: Polyline = {
      closed: true,
      points: [
        { x: 0.2, y: 0.2 },
        { x: 19.8, y: 0.2 },
        { x: 19.8, y: 19.8 },
        { x: 0.2, y: 19.8 },
        { x: 0.2, y: 12 },
        { x: 19.6, y: 10 },
        { x: 0.2, y: 8 },
      ],
    };
    // All inner vertices are within 0.4 mm of the outer; all outer
    // vertices are within sqrt(0.08) mm of the inner. Mid-notch edges
    // cross the interior almost 9 mm from the square's nearest side.
    expect(selectLineArtContours([outer, inner], 'inner', 2)).toEqual([outer, inner]);
  });
});
