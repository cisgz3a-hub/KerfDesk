import { beforeEach, describe, expect, it, vi } from 'vitest';

import type * as KerfOffsetModule from '../geometry/kerf-offset';
import type { Polyline } from '../scene';

// clipper2-ts fails internally on pathological geometry. kerf-offset catches it
// at the boundary (R6); the checked variant returns that failure as a Result so
// offset-fill can tell "the fill closed in on itself" apart from "the offset
// engine failed". Driving the Result directly is the only deterministic way to
// exercise both outcomes.
type CheckedOffset = typeof KerfOffsetModule.offsetClosedPolylinesForKerfChecked;

const offsetHarness = vi.hoisted(() => ({
  actual: undefined as CheckedOffset | undefined,
  checked: vi.fn<CheckedOffset>(),
}));

vi.mock('../geometry/kerf-offset', async (importOriginal) => {
  const actual = await importOriginal<typeof KerfOffsetModule>();
  offsetHarness.actual = actual.offsetClosedPolylinesForKerfChecked;
  return {
    ...actual,
    offsetClosedPolylinesForKerfChecked: offsetHarness.checked,
  };
});

const OFFSET_FAILURE = {
  kind: 'error',
  error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
} as const;

function offsetOk(contours: ReadonlyArray<Polyline>) {
  return { kind: 'ok', value: contours } as const;
}

const { offsetFillContours } = await import('./offset-fill');

const SQUARE: Polyline = {
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
  closed: true,
};

function shrunk(insetMm: number): Polyline {
  return {
    points: [
      { x: insetMm, y: insetMm },
      { x: 20 - insetMm, y: insetMm },
      { x: 20 - insetMm, y: 20 - insetMm },
      { x: insetMm, y: 20 - insetMm },
    ],
    closed: true,
  };
}

const REAL_SPACING_MM = 0.05;
const REAL_PASS_LIMIT = 2000;
const REAL_GEOMETRY_CASES = [
  {
    sizeMm: 200,
    expectedTermination: { kind: 'complete' },
    expectedLastXSpanMm: 0.05,
  },
  {
    sizeMm: 300,
    expectedTermination: { kind: 'pass-limit', passLimit: REAL_PASS_LIMIT },
    expectedLastXSpanMm: 100.05,
  },
  {
    sizeMm: 400,
    expectedTermination: { kind: 'pass-limit', passLimit: REAL_PASS_LIMIT },
    expectedLastXSpanMm: 200.05,
  },
] as const;

function square(sizeMm: number): Polyline {
  return {
    points: [
      { x: 0, y: 0 },
      { x: sizeMm, y: 0 },
      { x: sizeMm, y: sizeMm },
      { x: 0, y: sizeMm },
    ],
    closed: true,
  };
}

function xSpan(polyline: Polyline): number {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  for (const point of polyline.points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
  }
  return maxX - minX;
}

describe('offsetFillContours', () => {
  beforeEach(() => {
    const actual = offsetHarness.actual;
    if (actual === undefined) throw new Error('real checked offset implementation was not loaded');
    offsetHarness.checked.mockReset().mockImplementation(actual);
  });

  it('reports offset-failed when the very first offset pass fails', () => {
    offsetHarness.checked.mockImplementation(() => OFFSET_FAILURE);

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    // The regression: an empty contour list used to be the whole story, so a
    // failed fill was indistinguishable from a legitimately empty one.
    expect(result.contours).toEqual([]);
    expect(result.termination).toEqual({ kind: 'offset-failed' });
  });

  it('reports offset-failed when a later pass fails, and keeps the passes it did compute', () => {
    let calls = 0;
    offsetHarness.checked.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return offsetOk([shrunk(0.5)]);
      if (calls === 2) return offsetOk([shrunk(1.5)]);
      return OFFSET_FAILURE;
    });

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    expect(result.contours).toHaveLength(2);
    expect(result.termination).toEqual({ kind: 'offset-failed' });
  });

  it('reports complete when the fill simply closes in on itself', () => {
    let calls = 0;
    offsetHarness.checked.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? offsetOk([shrunk(0.5)]) : offsetOk([]);
    });

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    expect(result.contours).toHaveLength(1);
    expect(result.termination).toEqual({ kind: 'complete' });
  });

  it('reports complete when there is no usable source contour', () => {
    offsetHarness.checked.mockImplementation(() => offsetOk([]));

    const result = offsetFillContours({ polylines: [], spacingMm: 1 });

    expect(result.contours).toEqual([]);
    expect(result.termination).toEqual({ kind: 'complete' });
    expect(offsetHarness.checked).not.toHaveBeenCalled();
  });

  it('reports pass-limit when usable contours remain at the defensive bound', () => {
    offsetHarness.checked.mockImplementation((polylines: ReadonlyArray<Polyline>) =>
      offsetOk(polylines),
    );

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    // 20 mm / 1 mm + two defensive passes = 22. The mock intentionally keeps
    // returning usable geometry so this deterministic unit test reaches that
    // bound without paying for thousands of real Clipper operations.
    expect(result.contours).toHaveLength(22);
    expect(result.termination).toEqual({ kind: 'pass-limit', passLimit: 22 });
  });

  it('reports a final lookahead failure instead of misclassifying it as pass-limit', () => {
    let calls = 0;
    offsetHarness.checked.mockImplementation((polylines: ReadonlyArray<Polyline>) => {
      calls += 1;
      return calls <= 22 ? offsetOk(polylines) : OFFSET_FAILURE;
    });

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    expect(result.contours).toHaveLength(22);
    expect(result.termination).toEqual({ kind: 'offset-failed' });
  });

  it.each(REAL_GEOMETRY_CASES)(
    'classifies a $sizeMm mm square after 2,000 emitted inward-offset levels',
    ({ sizeMm, expectedTermination, expectedLastXSpanMm }) => {
      const result = offsetFillContours({
        polylines: [square(sizeMm)],
        spacingMm: REAL_SPACING_MM,
      });
      const last = result.contours.at(-1);

      expect(result.contours).toHaveLength(REAL_PASS_LIMIT);
      expect(last).toBeDefined();
      if (last === undefined) return;
      expect(xSpan(last)).toBeCloseTo(expectedLastXSpanMm, 6);
      expect(result.termination).toEqual(expectedTermination);
    },
  );
});
