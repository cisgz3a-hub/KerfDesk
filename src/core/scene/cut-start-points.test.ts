import { describe, expect, it } from 'vitest';
import {
  cutStartLocalPosition,
  cutStartPointAt,
  withCutStartPoint,
  withoutCutStartPoints,
} from './cut-start-points';
import { IDENTITY_TRANSFORM, type ColoredPath, type ImportedSvg } from './scene-object';

const RECTANGLE: ColoredPath = {
  color: '#ff0000',
  polylines: [
    {
      closed: true,
      points: [
        { x: 30, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 30 },
        { x: 20, y: 30 },
        { x: 20, y: 20 },
      ],
    },
    {
      closed: false,
      points: [
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ],
    },
  ],
};

// A closed curve: a line out, a cubic back. Its nodes are (0,0) and (20,0).
const CURVE: ColoredPath = {
  color: '#ff0000',
  polylines: [],
  curves: [
    {
      start: { x: 0, y: 0 },
      closed: true,
      segments: [
        { kind: 'line', to: { x: 20, y: 0 } },
        {
          kind: 'cubic',
          control1: { x: 20, y: 15 },
          control2: { x: 0, y: 15 },
          to: { x: 0, y: 0 },
        },
      ],
    },
  ],
};

function object(): ImportedSvg {
  return {
    kind: 'imported-svg',
    id: 'art',
    source: 'art.svg',
    bounds: { minX: 0, minY: 0, maxX: 40, maxY: 30 },
    transform: IDENTITY_TRANSFORM,
    paths: [RECTANGLE],
  };
}

describe('cut start points', () => {
  it('stores a node as a fraction of the contour perimeter', () => {
    const start = cutStartPointAt(RECTANGLE, 0, 0, { x: 40, y: 20 });
    expect(start).toEqual({ pathIndex: 0, polylineIndex: 0, pathT: 10 / 60 });
    expect(start === null ? null : cutStartLocalPosition(RECTANGLE, start)).toEqual({
      x: 40,
      y: 20,
    });
  });

  it('refuses open or missing contours', () => {
    expect(cutStartPointAt(RECTANGLE, 0, 1, { x: 5, y: 5 })).toBeNull();
    expect(cutStartPointAt(RECTANGLE, 0, 7, { x: 5, y: 5 })).toBeNull();
    expect(cutStartLocalPosition(RECTANGLE, { pathIndex: 0, polylineIndex: 7, pathT: 0 })).toBe(
      null,
    );
  });

  it('finds a curve node on the flattened contour', () => {
    const start = cutStartPointAt(CURVE, 0, 0, { x: 20, y: 0 });
    expect(start).not.toBeNull();
    const position = start === null ? null : cutStartLocalPosition(CURVE, start);
    expect(position?.x).toBeCloseTo(20, 9);
    expect(position?.y).toBeCloseTo(0, 9);
  });

  it('keeps one start per contour and clears them all', () => {
    const first = withCutStartPoint(object(), { pathIndex: 0, polylineIndex: 0, pathT: 0.1 });
    const replaced = withCutStartPoint(first, { pathIndex: 0, polylineIndex: 0, pathT: 0.6 });
    const other = withCutStartPoint(replaced, { pathIndex: 1, polylineIndex: 0, pathT: 0.2 });
    expect(other.cutStartPoints).toEqual([
      { pathIndex: 0, polylineIndex: 0, pathT: 0.6 },
      { pathIndex: 1, polylineIndex: 0, pathT: 0.2 },
    ]);
    const cleared = withoutCutStartPoints(other);
    expect('cutStartPoints' in cleared).toBe(false);
    const untouched = object();
    expect(withoutCutStartPoints(untouched)).toBe(untouched);
  });
});
