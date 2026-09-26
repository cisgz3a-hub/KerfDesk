import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CncTool, Polyline } from '../scene';
import type { Heightmap } from './heightmap';

const offsetChecked = vi.hoisted(() => vi.fn());

vi.mock('../geometry/kerf-offset', () => ({
  offsetClosedPolylinesForKerfChecked: offsetChecked,
}));

const { reliefRoughingLadder } = await import('./relief-roughing');

const MAX_RINGS_PER_LEVEL = 4096;
const TOOL: CncTool = { id: 'tiny', name: 'Tiny end mill', kind: 'end-mill', diameterMm: 0.125 };
const RING: Polyline = {
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ],
};
// A 3 x 3 pit inside a stock-top rim. The planning cutter is widened by the
// dual-grid clearance (ADR-412), so the pit must span more than one cell for
// its middle to reach the level.
const MAP: Heightmap = {
  widthCells: 5,
  heightCells: 5,
  widthMm: 5,
  heightMm: 5,
  mmPerCell: 1,
  depth: Float32Array.from(
    Array.from({ length: 25 }, (_, index) => {
      const x = index % 5;
      const y = Math.floor(index / 5);
      return x > 0 && x < 4 && y > 0 && y < 4 ? -1 : 0;
    }),
  ),
};

beforeEach(() => {
  offsetChecked.mockReset();
});

describe('reliefRoughingLadder bounded-ring evidence', () => {
  it('treats an empty non-emitting lookahead as exact exhaustion', () => {
    arrangeLookahead({ kind: 'ok', value: [] });

    const result = roughingResult();

    expect(result.passes).toHaveLength(MAX_RINGS_PER_LEVEL);
    expect(result).toMatchObject({ offsetFailed: false, passLimited: false });
    expect(offsetChecked).toHaveBeenCalledTimes(MAX_RINGS_PER_LEVEL + 1);
  });

  it('reports a pass limit only when the non-emitting lookahead still has interior', () => {
    arrangeLookahead({ kind: 'ok', value: [RING] });

    const result = roughingResult();

    expect(result.passes).toHaveLength(MAX_RINGS_PER_LEVEL);
    expect(result).toMatchObject({ offsetFailed: false, passLimited: true });
    expect(offsetChecked).toHaveBeenLastCalledWith(expect.any(Array), -409.6);
  });

  it('reports a lookahead engine failure without changing emitted rings', () => {
    arrangeLookahead({
      kind: 'error',
      error: { kind: 'operation-failed', message: 'diagnostic lookahead failed' },
    });

    const failed = roughingResult();
    const failedPasses = failed.passes;
    arrangeLookahead({ kind: 'ok', value: [] });
    const exhausted = roughingResult();

    expect(failed).toMatchObject({ offsetFailed: true, passLimited: false });
    expect(failedPasses).toEqual(exhausted.passes);
  });
});

function arrangeLookahead(result: unknown): void {
  offsetChecked.mockReset();
  offsetChecked.mockImplementationOnce(() => ({ kind: 'ok', value: [RING] }));
  for (let index = 1; index < MAX_RINGS_PER_LEVEL; index += 1) {
    offsetChecked.mockImplementationOnce(() => ({ kind: 'ok', value: [RING] }));
  }
  offsetChecked.mockImplementationOnce(() => result);
}

function roughingResult() {
  return reliefRoughingLadder(MAP, {
    tool: TOOL,
    reliefDepthMm: 1,
    depthPerPassMm: 1,
    stepoverPercent: 80,
    allowanceMm: 0,
  });
}
