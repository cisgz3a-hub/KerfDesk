import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Polyline } from '../scene';

// clipper2-ts fails internally on pathological geometry. kerf-offset catches it
// at the boundary (R6); the checked variant returns that failure as a Result so
// offset-fill can tell "the fill closed in on itself" apart from "the offset
// engine failed". Driving the Result directly is the only deterministic way to
// exercise both outcomes.
const offsetMock = vi.hoisted(() => vi.fn());

vi.mock('../geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerfChecked: offsetMock,
}));

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

describe('offsetFillContours', () => {
  beforeEach(() => {
    offsetMock.mockReset();
  });

  it('reports offsetFailed when the very first offset pass fails', () => {
    offsetMock.mockImplementation(() => OFFSET_FAILURE);

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    // The regression: an empty contour list used to be the whole story, so a
    // failed fill was indistinguishable from a legitimately empty one.
    expect(result.contours).toEqual([]);
    expect(result.offsetFailed).toBe(true);
  });

  it('reports offsetFailed when a later pass fails, and keeps the passes it did compute', () => {
    let calls = 0;
    offsetMock.mockImplementation(() => {
      calls += 1;
      if (calls === 1) return offsetOk([shrunk(0.5)]);
      if (calls === 2) return offsetOk([shrunk(1.5)]);
      return OFFSET_FAILURE;
    });

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    expect(result.contours).toHaveLength(2);
    expect(result.offsetFailed).toBe(true);
  });

  it('does not report a failure when the fill simply closes in on itself', () => {
    let calls = 0;
    offsetMock.mockImplementation(() => {
      calls += 1;
      return calls === 1 ? offsetOk([shrunk(0.5)]) : offsetOk([]);
    });

    const result = offsetFillContours({ polylines: [SQUARE], spacingMm: 1 });

    expect(result.contours).toHaveLength(1);
    expect(result.offsetFailed).toBe(false);
  });

  it('does not report a failure when there is no usable source contour', () => {
    offsetMock.mockImplementation(() => offsetOk([]));

    const result = offsetFillContours({ polylines: [], spacingMm: 1 });

    expect(result.contours).toEqual([]);
    expect(result.offsetFailed).toBe(false);
    expect(offsetMock).not.toHaveBeenCalled();
  });
});
