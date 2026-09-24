import { describe, expect, it } from 'vitest';
import { curveNodeCount, type CurveSubpath, type Vec2 } from '../scene';
import { pointOnSegment, segmentStartPoint } from './curve-segment-geometry';
import {
  breakCurveSubpathAtNode,
  deleteCurveSegment,
  insertCurveNode,
  removeCurveRange,
} from './curve-subpath-topology';

const WAVE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 10 }, control2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 20, y: 0 } },
    { kind: 'line', to: { x: 30, y: 0 } },
  ],
  closed: false,
};

// Square drawn with an implicit closing edge from (0,10) back to (0,0).
const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
  ],
  closed: true,
};

function nodes(path: CurveSubpath): ReadonlyArray<Vec2> {
  return [path.start, ...path.segments.map((segment) => segment.to)];
}

function tracePoints(path: CurveSubpath): ReadonlyArray<Vec2> {
  return path.segments.flatMap((segment, index) => {
    const from = segmentStartPoint(path, index) as Vec2;
    return [0.1, 0.5, 0.9].map((t) => pointOnSegment(from, segment, t));
  });
}

function distanceToTrace(point: Vec2, path: CurveSubpath): number {
  let best = Number.POSITIVE_INFINITY;
  path.segments.forEach((segment, index) => {
    const from = segmentStartPoint(path, index) as Vec2;
    for (let step = 0; step <= 400; step += 1) {
      const sample = pointOnSegment(from, segment, step / 400);
      best = Math.min(best, Math.hypot(sample.x - point.x, sample.y - point.y));
    }
  });
  return best;
}

describe('curve subpath topology', () => {
  it('inserts a node on a curve without moving the drawn shape', () => {
    const inserted = insertCurveNode(WAVE, 0, 0.3);
    expect(inserted).not.toBeNull();
    expect(curveNodeCount(inserted!)).toBe(curveNodeCount(WAVE) + 1);
    expect(inserted?.segments[0]?.kind).toBe('cubic');
    expect(inserted?.segments[1]?.kind).toBe('cubic');
    for (const point of tracePoints(inserted!)) {
      expect(distanceToTrace(point, WAVE)).toBeLessThan(0.02);
    }
  });

  it('refuses to insert on top of an existing node', () => {
    expect(insertCurveNode(WAVE, 1, 0)).toBeNull();
    expect(insertCurveNode(WAVE, 1, 1)).toBeNull();
    expect(insertCurveNode(WAVE, 9, 0.5)).toBeNull();
  });

  it('inserts on the implicit closing edge of a closed path', () => {
    const inserted = insertCurveNode(SQUARE, 3, 0.5);
    expect(inserted?.closed).toBe(true);
    expect(nodes(inserted!)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
      { x: 0, y: 0 },
    ]);
    expect(curveNodeCount(inserted!)).toBe(5);
  });

  it('deletes an interior segment of an open path into two paths', () => {
    const pieces = deleteCurveSegment(WAVE, 1);
    expect(pieces).toHaveLength(2);
    expect(pieces?.[0]).toMatchObject({ start: { x: 0, y: 0 }, closed: false });
    expect(pieces?.[0]?.segments).toEqual([WAVE.segments[0]]);
    expect(pieces?.[1]).toEqual({
      start: { x: 20, y: 0 },
      segments: [{ kind: 'line', to: { x: 30, y: 0 } }],
      closed: false,
    });
  });

  it('deletes an end segment by shortening the path', () => {
    const pieces = deleteCurveSegment(WAVE, 2);
    expect(pieces).toHaveLength(1);
    expect(nodes(pieces![0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const first = deleteCurveSegment(WAVE, 0);
    expect(first?.[0]?.start).toEqual({ x: 10, y: 0 });
    expect(deleteCurveSegment({ ...WAVE, segments: [WAVE.segments[1]!] }, 0)).toEqual([]);
    expect(deleteCurveSegment(WAVE, 3)).toBeNull();
  });

  it('opens a closed path where a segment is deleted', () => {
    const pieces = deleteCurveSegment(SQUARE, 1);
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0]?.closed).toBe(false);
    // The rest of the loop runs from the deleted segment's end round to its start.
    expect(nodes(pieces![0]!)).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ]);
    const closing = deleteCurveSegment(SQUARE, 3);
    expect(nodes(closing![0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ]);
  });

  it('breaks a closed path at a node into one open path through every segment', () => {
    const pieces = breakCurveSubpathAtNode(SQUARE, 2);
    expect(pieces).toHaveLength(1);
    expect(pieces?.[0]?.closed).toBe(false);
    expect(nodes(pieces![0]!)).toEqual([
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('breaks an open path at an interior node into two paths', () => {
    const pieces = breakCurveSubpathAtNode(WAVE, 2);
    expect(pieces).toHaveLength(2);
    expect(nodes(pieces![0]!)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(nodes(pieces![1]!)).toEqual([
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(breakCurveSubpathAtNode(WAVE, 0)).toBeNull();
    expect(breakCurveSubpathAtNode(WAVE, 3)).toBeNull();
  });

  it('cuts a stretch out of a closed path across its seam', () => {
    const kept = removeCurveRange(SQUARE, { segmentIndex: 3, t: 0.5 }, { segmentIndex: 0, t: 0.5 });
    expect(kept).toHaveLength(1);
    expect(nodes(kept[0]!)).toEqual([
      { x: 5, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
    ]);
  });

  it('keeps the short stretch when the cut wraps back into its own segment', () => {
    const kept = removeCurveRange(
      SQUARE,
      { segmentIndex: 1, t: 0.75 },
      { segmentIndex: 1, t: 0.25 },
    );
    expect(kept).toHaveLength(1);
    expect(nodes(kept[0]!)).toEqual([
      { x: 10, y: 2.5 },
      { x: 10, y: 7.5 },
    ]);
  });

  it('cuts a stretch out of an open path, keeping both sides', () => {
    const kept = removeCurveRange(WAVE, { segmentIndex: 1, t: 0.5 }, { segmentIndex: 2, t: 0.5 });
    expect(kept).toHaveLength(2);
    expect(kept[0]?.segments.at(-1)?.to).toEqual({ x: 15, y: 0 });
    expect(kept[1]).toEqual({
      start: { x: 25, y: 0 },
      segments: [{ kind: 'line', to: { x: 30, y: 0 } }],
      closed: false,
    });
  });
});
