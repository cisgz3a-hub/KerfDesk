// ADR-453 (batch 3 integration): a cubic and its reverse flatten to the same
// vertices, so two filled paths sharing a seam (colour layers) meet exactly.

import { describe, expect, it } from 'vitest';
import { flattenCubicChords, flattenEllipseChords, type ChordEllipse } from './curve-flatten';
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

describe('elliptical seams retain the same chords in both directions', () => {
  it.each([1.8, -1.8, 4.5, -4.5])('preserves an eccentric seam with sweep %s', (delta) => {
    const arc: ChordEllipse = {
      center: { x: 200, y: 200 },
      radiusX: 100,
      radiusY: 7,
      rotationRad: 0.4,
      theta1: 0.3,
      delta,
    };
    const point = (theta: number): Vec2 => ({
      x:
        arc.center.x +
        arc.radiusX * Math.cos(theta) * Math.cos(arc.rotationRad) -
        arc.radiusY * Math.sin(theta) * Math.sin(arc.rotationRad),
      y:
        arc.center.y +
        arc.radiusX * Math.cos(theta) * Math.sin(arc.rotationRad) +
        arc.radiusY * Math.sin(theta) * Math.cos(arc.rotationRad),
    });
    const from = point(arc.theta1),
      to = point(arc.theta1 + delta);
    const forward = flattenEllipseChords(from, to, arc, 0.025, 200_000);
    const backward = flattenEllipseChords(
      to,
      from,
      { ...arc, theta1: arc.theta1 + delta, delta: -delta },
      0.025,
      200_000,
    );
    if (forward === null || backward === null) throw new Error('flatten refused');
    const expected = [to, ...backward].reverse();
    const actual = [from, ...forward];
    expect(actual.length).toBe(expected.length);
    actual.forEach((p, i) => {
      expect(p.x).toBeCloseTo(expected[i]!.x, 9);
      expect(p.y).toBeCloseTo(expected[i]!.y, 9);
    });
    expect(forward.at(-1)).toBe(to);
    expect(backward.at(-1)).toBe(from);
  });
});
