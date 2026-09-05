import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOffsetLadder } from '../geometry/offset-ladder';
import * as polygons from '../geometry/polygon-difference';
import * as strokes from '../geometry/round-stroke-outline';
import type { Polyline } from '../scene';
import { pocketRingToolpaths } from './pocket-paths';

const contour: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 20, y: 0 },
    { x: 20, y: 20 },
    { x: 0, y: 20 },
  ],
};
const TOOL = 3.175;

afterEach(() => vi.restoreAllMocks());

function expectRetainedRingsWithWarning(): void {
  const regular = [...buildOffsetLadder([contour], 4096, (k) => TOOL / 2 + k * TOOL * 0.85).rings]
    .reverse()
    .flat();
  const result = pocketRingToolpaths([contour], TOOL, 85);
  expect(result.offsetFailed).toBe(true);
  expect(result.passLimited).toBe(false);
  expect(result.toolpaths.slice(-regular.length)).toEqual(regular);
}

describe('pocket core coverage geometry failure', () => {
  it('retains planned rings and reports a failed cutter sweep', () => {
    vi.spyOn(strokes, 'roundStrokeOutline').mockReturnValueOnce(null);
    expectRetainedRingsWithWarning();
  });

  it('retains planned rings and reports a failed stock subtraction', () => {
    vi.spyOn(polygons, 'differenceClosedPolylinesChecked').mockReturnValueOnce({
      kind: 'error',
      error: { kind: 'operation-failed', message: 'Injected geometry failure' },
    });
    expectRetainedRingsWithWarning();
  });
});
