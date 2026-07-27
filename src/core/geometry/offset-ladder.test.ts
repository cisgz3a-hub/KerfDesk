import { describe, expect, it, vi } from 'vitest';

import type { Polyline } from '../scene';

// The ladder is under test, not clipper: the whole point of the module is WHY
// the loop stopped, so the offset engine is mocked to produce each ending
// exactly. Real-clipper coverage lives in the callers' own suites.
const offsetChecked = vi.hoisted(() => vi.fn());

vi.mock('./kerf-offset', () => ({
  offsetClosedPolylinesForKerf: () => [],
  offsetClosedPolylinesForKerfChecked: offsetChecked,
  offsetClosedPolylinesWithRoundJoins: () => [],
}));

const { buildOffsetLadder, insetContoursChecked } = await import('./offset-ladder');

const SQUARE: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ],
};

function ok(value: ReadonlyArray<Polyline>): unknown {
  return { kind: 'ok', value };
}

function engineFailure(): unknown {
  return {
    kind: 'error',
    error: { kind: 'operation-failed', message: 'clipper2: pathological geometry' },
  };
}

function offsetsReturning(...results: ReadonlyArray<unknown>): void {
  offsetChecked.mockReset();
  for (const result of results) offsetChecked.mockReturnValueOnce(result);
  offsetChecked.mockReturnValue(ok([]));
}

describe('buildOffsetLadder', () => {
  it('runs until the region has no interior left, and says so', () => {
    offsetsReturning(ok([SQUARE]), ok([SQUARE]), ok([]));

    const ladder = buildOffsetLadder([SQUARE], 10, (step) => step);

    expect(ladder.rings).toHaveLength(2);
    expect(ladder.offsetFailed).toBe(false);
  });

  // The defect this module exists to remove: a failed offset returns no
  // contours, which is exactly what "ran out of interior" returns. Conflating
  // them truncates a CNC toolpath and leaves uncut material behind.
  it('reports an ENGINE FAILURE distinctly from running out of interior', () => {
    offsetsReturning(ok([SQUARE]), ok([SQUARE]), engineFailure());

    const ladder = buildOffsetLadder([SQUARE], 10, (step) => step);

    expect(ladder.offsetFailed).toBe(true);
    // The rings built before the failure are still usable output — the ladder
    // is truncated, not void.
    expect(ladder.rings).toHaveLength(2);
  });

  it('keeps the steps it completed before a failure on the very first step', () => {
    offsetsReturning(engineFailure());

    const ladder = buildOffsetLadder([SQUARE], 10, (step) => step);

    expect(ladder.rings).toEqual([]);
    expect(ladder.offsetFailed).toBe(true);
  });

  it('stops at maxSteps without calling that a failure', () => {
    offsetsReturning(ok([SQUARE]), ok([SQUARE]), ok([SQUARE]), ok([SQUARE]));

    const ladder = buildOffsetLadder([SQUARE], 3, (step) => step);

    expect(ladder.rings).toHaveLength(3);
    expect(ladder.offsetFailed).toBe(false);
    expect(offsetChecked).toHaveBeenCalledTimes(3);
  });

  // Insets are POSITIVE distances inward; the engine takes a signed offset.
  it('offsets inward by the negated inset of each step', () => {
    offsetsReturning(ok([SQUARE]), ok([SQUARE]), ok([]));

    buildOffsetLadder([SQUARE], 10, (step) => 1.5 + step * 0.25);

    expect(offsetChecked.mock.calls.map((call) => call[1])).toEqual([-1.5, -1.75, -2]);
  });
});

describe('insetContoursChecked', () => {
  it('separates an empty result from a failed one', () => {
    offsetsReturning(ok([]));
    expect(insetContoursChecked([SQUARE], 1)).toEqual({ contours: [], offsetFailed: false });

    offsetsReturning(engineFailure());
    expect(insetContoursChecked([SQUARE], 1)).toEqual({ contours: [], offsetFailed: true });
  });

  it('passes the inset through as an inward offset', () => {
    offsetsReturning(ok([SQUARE]));

    const inset = insetContoursChecked([SQUARE], 2.5);

    expect(inset).toEqual({ contours: [SQUARE], offsetFailed: false });
    expect(offsetChecked).toHaveBeenCalledWith([SQUARE], -2.5);
  });
});
