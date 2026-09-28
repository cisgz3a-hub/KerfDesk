import { describe, expect, it } from 'vitest';
import type { Vec2 } from '../../../core/scene';
import {
  distanceToSegment,
  MAX_NEAR_SEGMENTS,
  nearestCrossing,
  type WorldSegment,
} from './snap-intersections';

describe('nearestCrossing', () => {
  it('finds the crossing of two segments from different objects', () => {
    const crossing = nearestCrossing(
      [
        segment({ x: 0, y: 0 }, { x: 10, y: 10 }, 'a'),
        segment({ x: 0, y: 10 }, { x: 10, y: 0 }, 'b'),
      ],
      { x: 5.5, y: 5 },
      1,
    );

    expect(crossing?.pointMm.x).toBeCloseTo(5);
    expect(crossing?.pointMm.y).toBeCloseTo(5);
    expect(crossing?.distanceMm).toBeCloseTo(0.5);
    expect(crossing?.objectId).toBe('a');
  });

  it('ignores parallel segments and crossings that exist only on an extension', () => {
    const pointer = { x: 5, y: 0.5 };

    expect(
      nearestCrossing(
        [
          segment({ x: 0, y: 0 }, { x: 10, y: 0 }, 'a'),
          segment({ x: 0, y: 1 }, { x: 10, y: 1 }, 'b'),
        ],
        pointer,
        2,
      ),
    ).toBeNull();
    expect(
      nearestCrossing(
        [
          segment({ x: 0, y: 0 }, { x: 4, y: 0 }, 'a'),
          segment({ x: 5, y: -1 }, { x: 5, y: 1 }, 'b'),
        ],
        pointer,
        2,
      ),
    ).toBeNull();
  });

  it('skips two neighbouring segments of one subpath that meet at their shared node', () => {
    const corner = { x: 5, y: 5 };
    const neighbours = [
      segment({ x: 0, y: 5 }, corner, 'a', 'a|0:0'),
      segment(corner, { x: 5, y: 0 }, 'a', 'a|0:0'),
    ];

    expect(nearestCrossing(neighbours, { x: 5, y: 4.5 }, 1)).toBeNull();
    // The same geometry from two different subpaths does meet there.
    const separate = [
      neighbours[0] as WorldSegment,
      { ...(neighbours[1] as WorldSegment), subpathKey: 'a|0:1' },
    ];
    expect(nearestCrossing(separate, { x: 5, y: 4.5 }, 1)?.pointMm).toEqual(corner);
  });

  it('keeps the crossing nearest the pointer, and none beyond the reach', () => {
    const vertical = (x: number) => segment({ x, y: -5 }, { x, y: 5 }, `v${x}`);
    const segments = [segment({ x: 0, y: 0 }, { x: 20, y: 0 }, 'h'), vertical(4), vertical(6)];

    expect(nearestCrossing(segments, { x: 5.8, y: 0.3 }, 3)?.pointMm).toEqual({ x: 6, y: 0 });
    expect(nearestCrossing(segments, { x: 10, y: 0 }, 3)).toBeNull();
  });

  it('pairs at most the nearest MAX_NEAR_SEGMENTS segments', () => {
    // Many horizontal segments near the pointer, and one far vertical crossing
    // them that is within reach only through its farthest part.
    const crowd = Array.from({ length: MAX_NEAR_SEGMENTS + 10 }, (_, i) =>
      segment({ x: -1, y: i * 0.001 }, { x: 1, y: i * 0.001 }, `h${i}`),
    );
    const crossing = nearestCrossing(
      [...crowd, segment({ x: 0.5, y: -1 }, { x: 0.5, y: 1 }, 'v')],
      { x: 0, y: 0 },
      2,
    );

    // The vertical is 0.5 mm away, farther than every crowd member; it is not
    // among the nearest, so no pair includes it.
    expect(crossing).toBeNull();
  });
});

describe('distanceToSegment', () => {
  it('measures to the segment, clamped to its ends', () => {
    const s = segment({ x: 0, y: 0 }, { x: 10, y: 0 }, 'a');

    expect(distanceToSegment({ x: 5, y: 3 }, s)).toBeCloseTo(3);
    expect(distanceToSegment({ x: 13, y: 4 }, s)).toBeCloseTo(5);
    expect(
      distanceToSegment({ x: 1, y: 1 }, segment({ x: 0, y: 0 }, { x: 0, y: 0 }, 'p')),
    ).toBeCloseTo(Math.SQRT2);
  });
});

function segment(
  fromMm: Vec2,
  toMm: Vec2,
  entityId: string,
  subpathKey = `${entityId}|0:0`,
): WorldSegment {
  return { fromMm, toMm, entityId, subpathKey };
}
