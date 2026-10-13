import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type ColoredPath, type CurveSubpath, type Polyline } from '../scene';
import { closePathsWithinTolerance } from './close-within-tolerance';

// An open U whose ends are 0.4 mm apart, as a curve with a cubic last segment.
const U: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 0, y: 10 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'cubic', control1: { x: 10, y: 6 }, control2: { x: 4, y: 0 }, to: { x: 0.4, y: 0 } },
  ],
  closed: false,
};
const U_POLY: Polyline = {
  points: [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
    { x: 0.4, y: 0 },
  ],
  closed: false,
};
const WIDE: Polyline = {
  points: [
    { x: 50, y: 0 },
    { x: 50, y: 10 },
    { x: 60, y: 10 },
    { x: 55, y: 0 },
  ],
  closed: false,
};

const paths: ReadonlyArray<ColoredPath> = [
  { color: '#000000', curves: [U], polylines: [U_POLY] },
  { color: '#000000', polylines: [WIDE] },
];

describe('closePathsWithinTolerance', () => {
  it('bridges only the gaps within tolerance and counts the rest', () => {
    const result = closePathsWithinTolerance(paths, IDENTITY_TRANSFORM, 0.5, 'bridge');
    expect(result).toMatchObject({ closed: 1, remaining: 1 });
    const curve = result.paths[0]?.curves?.[0];
    expect(curve?.closed).toBe(true);
    expect(curve?.segments.at(-1)).toEqual({ kind: 'line', to: { x: 0, y: 0 } });
    expect(result.paths[1]).toBe(paths[1]);
  });

  it('moves both ends to their midpoint and carries the cubic control with its end', () => {
    const result = closePathsWithinTolerance(paths, IDENTITY_TRANSFORM, 0.5, 'move-ends');
    const curve = result.paths[0]?.curves?.[0];
    expect(curve?.start).toEqual({ x: 0.2, y: 0 });
    expect(curve?.segments).toHaveLength(3);
    expect(curve?.segments[2]).toMatchObject({ control2: { x: 3.8, y: 0 }, to: { x: 0.2, y: 0 } });
    expect(result.paths[0]?.polylines[0]?.points).toEqual([
      { x: 0.2, y: 0 },
      { x: 0, y: 10 },
      { x: 10, y: 10 },
      { x: 0.2, y: 0 },
    ]);
  });

  it('measures the gap after the object transform', () => {
    const scaled = { ...IDENTITY_TRANSFORM, scaleX: 2, scaleY: 2 };
    expect(closePathsWithinTolerance(paths, scaled, 0.5, 'bridge').closed).toBe(0);
    expect(closePathsWithinTolerance(paths, scaled, 0.8, 'bridge').closed).toBe(1);
  });
});
