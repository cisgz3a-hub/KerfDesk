import { describe, expect, it, vi } from 'vitest';
import type { Vec2 } from '../../scene';
import { type Chain } from './junction-pairing';
import { repairJunctionSeams, weldBranchEnds } from './seam-repair';
import { SegmentGrid } from './spatial-grid';

const line = (a: Vec2, b: Vec2): Chain => ({ points: [a, b], closed: false, alive: true });

describe('seam repair search work', () => {
  it('does not scan every chain point for distant junction landmarks', () => {
    const points = Array.from({ length: 500 }, (_, x) => ({ x, y: 0 }));
    const junctions = Array.from({ length: 500 }, (_, x) => ({ x, y: 10 }));
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      expect(repairJunctionSeams(points, false, junctions, new Float64Array(0), 0)).toEqual(points);
      expect(hypot.mock.calls.length).toBeLessThan(5000);
    } finally {
      hypot.mockRestore();
    }
  });

  it('indexes changed weld segments without repeatedly indexing the whole drawing', () => {
    const junctions = Array.from({ length: 100 }, (_, i) => ({ x: i * 20, y: 1 }));
    const chains = junctions.flatMap((point) => [
      line({ x: point.x - 4, y: 0 }, { x: point.x + 4, y: 0 }),
      line({ x: point.x, y: 5 }, point),
    ]);
    const insert = vi.spyOn(SegmentGrid.prototype, 'insert');
    try {
      weldBranchEnds(chains, junctions);
      for (let i = 1; i < chains.length; i += 2) expect(chains[i]?.points.at(-1)?.y).toBe(0);
      expect(insert.mock.calls.length).toBeLessThan(400);
    } finally {
      insert.mockRestore();
    }
  });

  it('lets later endpoints land on a segment moved by an earlier weld', () => {
    const seat = line({ x: -2, y: 3 }, { x: 2, y: 3 });
    const moved = line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const branch = line({ x: 8, y: 3 }, { x: 8, y: 6 });
    weldBranchEnds(
      [seat, moved, branch],
      [
        { x: 0, y: 0 },
        { x: 8, y: 3 },
      ],
    );
    expect(moved.points[0]).toEqual({ x: 0, y: 3 });
    expect(branch.points[0]?.x).toBeCloseTo(800 / 109, 12);
    expect(branch.points[0]?.y).toBeCloseTo(3 - 240 / 109, 12);
  });
});
