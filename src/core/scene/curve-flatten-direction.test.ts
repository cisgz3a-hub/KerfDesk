// ADR-442 (batch 3 integration): a cubic and its reverse flatten to the same
// vertices, so two filled paths sharing a seam (colour layers) meet exactly.

import { describe, expect, it } from 'vitest';
import { flattenCubicChords } from './curve-flatten';
import type { CubicPathSegment, Vec2 } from './scene-object';

function reverse(from: Vec2, segment: CubicPathSegment): [Vec2, CubicPathSegment] {
  return [
    segment.to,
    { kind: 'cubic', control1: segment.control2, control2: segment.control1, to: from },
  ];
}

const seams: ReadonlyArray<[Vec2, CubicPathSegment]> = [
  // Asymmetric S: the greedy walk ends differently from each end.
  [
    { x: 0, y: 0 },
    { kind: 'cubic', control1: { x: 3, y: 9 }, control2: { x: 11, y: -4 }, to: { x: 17, y: 2 } },
  ],
  [
    { x: 40, y: 5 },
    { kind: 'cubic', control1: { x: 31, y: 18 }, control2: { x: 2, y: 1 }, to: { x: -6, y: 12 } },
  ],
  // Closed loop: the ends tie, so the controls pick the direction.
  [
    { x: 5, y: 5 },
    { kind: 'cubic', control1: { x: 25, y: 30 }, control2: { x: -20, y: 22 }, to: { x: 5, y: 5 } },
  ],
];

describe('cubic flattening is independent of direction', () => {
  it.each(seams)('flattens a seam and its reverse to the same vertices', (from, segment) => {
    const forward = flattenCubicChords(from, segment, 0.025, 1_000_000);
    const [backFrom, backSegment] = reverse(from, segment);
    const backward = flattenCubicChords(backFrom, backSegment, 0.025, 1_000_000);
    if (forward === null || backward === null) throw new Error('flatten refused');
    expect(forward.length).toBeGreaterThan(2);
    expect([from, ...forward]).toEqual([backFrom, ...backward].reverse());
    // The segment's own ends stay exact in both directions.
    expect(forward.at(-1)).toBe(segment.to);
    expect(backward.at(-1)).toBe(backSegment.to);
  });
});
