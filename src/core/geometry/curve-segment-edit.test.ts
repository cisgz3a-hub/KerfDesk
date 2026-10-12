import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type CurveSubpath } from '../scene';
import {
  breakOpenCurveAtNode,
  curveSegmentCount,
  curveSegmentPoint,
  deleteCurveSegment,
  dragCurveSegment,
  insertCurveNode,
  nearestCurveSegment,
} from './curve-segment-edit';

const SQUARE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'line', to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 10, y: 10 } },
    { kind: 'line', to: { x: 0, y: 10 } },
  ],
  closed: true,
};

const WAVE: CurveSubpath = {
  start: { x: 0, y: 0 },
  segments: [
    { kind: 'cubic', control1: { x: 0, y: 10 }, control2: { x: 10, y: 10 }, to: { x: 10, y: 0 } },
    { kind: 'line', to: { x: 20, y: 0 } },
    { kind: 'line', to: { x: 30, y: 0 } },
  ],
  closed: false,
};

describe('insertCurveNode', () => {
  it('splits a cubic exactly, so the shape is unchanged', () => {
    const inserted = insertCurveNode(WAVE, 0, 0.5);
    if (inserted === null) throw new Error('expected an insert');
    expect(inserted.segments).toHaveLength(4);
    expect(inserted.segments[0]?.to).toEqual({ x: 5, y: 7.5 });
    for (const t of [0.1, 0.3, 0.45]) {
      const before = curveSegmentPoint(WAVE, 0, t);
      const after = curveSegmentPoint(inserted, 0, t / 0.5);
      expect(after?.x).toBeCloseTo(before?.x ?? Number.NaN, 9);
      expect(after?.y).toBeCloseTo(before?.y ?? Number.NaN, 9);
    }
  });

  it('can split a closed contour on its implied closing line', () => {
    expect(curveSegmentCount(SQUARE)).toBe(4);
    const inserted = insertCurveNode(SQUARE, 3, 0.5);
    expect(inserted?.segments.map((segment) => segment.to)).toEqual([
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 0, y: 5 },
      { x: 0, y: 0 },
    ]);
    expect(insertCurveNode(SQUARE, 0, 0)).toBeNull();
    expect(insertCurveNode(SQUARE, 9, 0.5)).toBeNull();
  });
});

describe('deleteCurveSegment', () => {
  it('opens a closed contour where the segment was', () => {
    expect(deleteCurveSegment(SQUARE, 1)).toEqual([
      {
        start: { x: 10, y: 10 },
        segments: [
          { kind: 'line', to: { x: 0, y: 10 } },
          { kind: 'line', to: { x: 0, y: 0 } },
          { kind: 'line', to: { x: 10, y: 0 } },
        ],
        closed: false,
      },
    ]);
  });

  it('splits an open contour and drops an empty end', () => {
    const middle = deleteCurveSegment(WAVE, 1);
    expect(middle?.map((piece) => [piece.start, piece.segments.length])).toEqual([
      [{ x: 0, y: 0 }, 1],
      [{ x: 20, y: 0 }, 1],
    ]);
    expect(deleteCurveSegment(WAVE, 0)?.map((piece) => piece.start)).toEqual([{ x: 10, y: 0 }]);
  });
});

describe('breakOpenCurveAtNode', () => {
  it('breaks an open contour at an interior node only', () => {
    expect(
      breakOpenCurveAtNode(WAVE, 2)?.map((piece) => [piece.start, piece.segments.length]),
    ).toEqual([
      [{ x: 0, y: 0 }, 2],
      [{ x: 20, y: 0 }, 1],
    ]);
    expect(breakOpenCurveAtNode(WAVE, 0)).toBeNull();
    expect(breakOpenCurveAtNode(SQUARE, 1)).toBeNull();
  });
});

describe('dragCurveSegment', () => {
  it('bends a line so the grabbed point follows the pointer and the ends stay', () => {
    const dragged = dragCurveSegment(WAVE, 1, 0.5, { x: 0, y: 4 });
    expect(dragged?.segments[1]?.kind).toBe('cubic');
    expect(curveSegmentPoint(dragged as CurveSubpath, 1, 0.5)).toEqual({ x: 15, y: 4 });
    expect(curveSegmentPoint(dragged as CurveSubpath, 1, 0)).toEqual({ x: 10, y: 0 });
    expect(curveSegmentPoint(dragged as CurveSubpath, 1, 1)).toEqual({ x: 20, y: 0 });
  });

  it('moves the grabbed point of a cubic by exactly the drag', () => {
    const before = curveSegmentPoint(WAVE, 0, 0.3) as { x: number; y: number };
    const after = curveSegmentPoint(
      dragCurveSegment(WAVE, 0, 0.3, { x: 1, y: -2 }) as CurveSubpath,
      0,
      0.3,
    );
    expect(after?.x).toBeCloseTo(before.x + 1, 9);
    expect(after?.y).toBeCloseTo(before.y - 2, 9);
  });
});

describe('nearestCurveSegment', () => {
  it('finds the segment and parameter under a transformed pointer', () => {
    const hit = nearestCurveSegment(
      SQUARE,
      { ...IDENTITY_TRANSFORM, x: 100, scaleX: 2 },
      { x: 121, y: 3 },
    );
    expect(hit?.segmentIndex).toBe(1);
    expect(hit?.t).toBeCloseTo(0.3, 6);
    expect(hit?.distance).toBeCloseTo(1, 6);
  });
});
