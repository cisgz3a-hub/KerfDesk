import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap, HeightmapExactSurface } from './heightmap';
import { createSurfaceContactField } from './heightmap-surface-contact';
import { oracleContact, type Surface } from './heightmap-surface-contact-oracle.test-support';

// ADR-579: the exact cutter contact with a mesh relief's own triangles, checked
// against the independent search oracle on random triangle soups, plus known
// answers, the stock-top background and the per-move element selection.

const FLAT: CncTool = { id: 'flat', name: 'flat', kind: 'end-mill', diameterMm: 1.4 };
const BALL: CncTool = { id: 'ball', name: 'ball', kind: 'ball-nose', diameterMm: 1.4 };
const V_BIT: CncTool = { id: 'v', name: 'v-bit', kind: 'v-bit', diameterMm: 1.4, tipAngleDeg: 60 };
const ENGRAVING: CncTool = {
  id: 'engraving',
  name: 'engraving',
  kind: 'engraving',
  diameterMm: 1.4,
  tipAngleDeg: 45,
  tipDiameterMm: 0.2,
};
const TAPERED: CncTool = {
  id: 'tapered',
  name: 'tapered ball',
  kind: 'tapered-ball-nose',
  diameterMm: 1.4,
  tipDiameterMm: 0.5,
  tipAngleDeg: 30,
};
const TOOLS = [FLAT, BALL, V_BIT, ENGRAVING, TAPERED] as const;
const CELLS = 20;
const MM_PER_CELL = 0.25;
const SIDE_MM = CELLS * MM_PER_CELL;

type P = { readonly x: number; readonly y: number; readonly z: number };

function meshMap(
  triangles: ReadonlyArray<readonly [P, P, P]>,
  uncoveredTop?: Uint8Array,
): Heightmap {
  const flat = new Float64Array(triangles.length * 9);
  triangles.forEach((triangle, t) => {
    triangle.forEach((p, k) => flat.set([p.x, p.y, p.z], t * 9 + k * 3));
  });
  const exactSurface: HeightmapExactSurface =
    uncoveredTop === undefined ? { triangles: flat } : { triangles: flat, uncoveredTop };
  return {
    widthCells: CELLS,
    heightCells: CELLS,
    widthMm: SIDE_MM,
    heightMm: SIDE_MM,
    mmPerCell: MM_PER_CELL,
    depth: new Float32Array(CELLS * CELLS).fill(-6),
    exactSurface,
  };
}

function oracleSurface(triangles: ReadonlyArray<readonly [P, P, P]>): Surface {
  const planar = triangles.filter(
    ([a, b, c]) => Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) > 1e-9,
  );
  const edges = triangles.flatMap(([a, b, c]) => [
    [a, b] as const,
    [b, c] as const,
    [c, a] as const,
  ]);
  return { triangles: planar, edges: edges.filter(([p, q]) => p.x !== q.x || p.y !== q.y) };
}

// The oracle's edges need plan length; corners are scored on their own.
function oracle(
  kernel: ToolKernel,
  triangles: ReadonlyArray<readonly [P, P, P]>,
  x: number,
  y: number,
) {
  let best = oracleContact(kernel, oracleSurface(triangles), x, y);
  for (const p of triangles.flat()) {
    const d = Math.hypot(p.x - x, p.y - y);
    if (d <= kernel.radiusMm) best = Math.max(best, p.z - kernel.surfaceDzAtRadius(d));
  }
  return best;
}

function field(map: Heightmap, kernel: ToolKernel) {
  const created = createSurfaceContactField(map, kernel);
  if (created === null) throw new Error('expected a contact field');
  return created;
}

// Micron resolution, as STL coordinates reach the emitter: coincident corners
// occur, subnormal edge lengths (which defeat the oracle's own search) do not.
const coordinate = fc.integer({ min: 0, max: SIDE_MM * 1000 }).map((value) => value / 1000);
const height = fc.integer({ min: -5000, max: 0 }).map((value) => value / 1000);
const point = fc.record({ x: coordinate, y: coordinate, z: height });
const triangle = fc.tuple(point, point, point);

describe('mesh contact matches the independent oracle', () => {
  it.each(TOOLS.map((tool) => [tool.kind, tool] as const))('%s', (_kind, tool) => {
    fc.assert(
      fc.property(
        fc.array(triangle, { minLength: 1, maxLength: 12 }),
        coordinate,
        coordinate,
        (triangles, x, y) => {
          const kernel = kernelForTool(tool, MM_PER_CELL);
          const exact = field(meshMap(triangles), kernel).constraintAtPoint(
            x,
            y,
            Number.NEGATIVE_INFINITY,
          );
          const expected = oracle(kernel, triangles, x, y);
          if (expected === Number.NEGATIVE_INFINITY) {
            expect(exact).toBe(Number.NEGATIVE_INFINITY);
          } else {
            expect(exact).toBeCloseTo(expected, 6);
          }
        },
      ),
      { numRuns: 80, seed: 578 },
    );
  });

  it('solves a roughing envelope widened by the allowance', () => {
    fc.assert(
      fc.property(
        fc.array(triangle, { minLength: 1, maxLength: 8 }),
        coordinate,
        coordinate,
        (t, x, y) => {
          for (const tool of [FLAT, BALL, V_BIT]) {
            const kernel = kernelForTool(tool, MM_PER_CELL, 0, 0.6);
            const exact = field(meshMap(t), kernel).constraintAtPoint(
              x,
              y,
              Number.NEGATIVE_INFINITY,
            );
            const expected = oracle(kernel, t, x, y);
            if (expected !== Number.NEGATIVE_INFINITY) expect(exact).toBeCloseTo(expected, 5);
          }
        },
      ),
      { numRuns: 40, seed: 5781 },
    );
  });
});

describe('mesh contact known answers', () => {
  const plane = (slope: number): Array<readonly [P, P, P]> => {
    const z = (x: number): number => -4 + slope * x;
    const a = { x: 0, y: 0, z: z(0) };
    const b = { x: SIDE_MM, y: 0, z: z(SIDE_MM) };
    const c = { x: SIDE_MM, y: SIDE_MM, z: z(SIDE_MM) };
    const d = { x: 0, y: SIDE_MM, z: z(0) };
    return [
      [a, b, c],
      [a, c, d],
    ];
  };

  it('a ball on a plane rides r (sec - 1) above it, with no grid error', () => {
    const r = BALL.diameterMm / 2;
    for (const slope of [0, 0.3, 1, 2.5]) {
      const contact = field(meshMap(plane(slope)), kernelForTool(BALL, MM_PER_CELL));
      const x = 2.37;
      const tip = contact.constraintAtPoint(x, 2.5, Number.NEGATIVE_INFINITY);
      expect(tip).toBeCloseTo(-4 + slope * x + r * (Math.sqrt(1 + slope * slope) - 1), 9);
    }
  });

  it('a vertical wall stops a flat end mill at the wall top within its radius', () => {
    const top = { x: 2, y: 0, z: -1 };
    const wall: Array<readonly [P, P, P]> = [
      [{ x: 2, y: 0, z: -5 }, top, { x: 2, y: SIDE_MM, z: -1 }],
      [
        { x: 2, y: 0, z: -5 },
        { x: 2, y: SIDE_MM, z: -1 },
        { x: 2, y: SIDE_MM, z: -5 },
      ],
    ];
    const contact = field(meshMap(wall), kernelForTool(FLAT, MM_PER_CELL));
    expect(contact.constraintAtPoint(2.69, 2, Number.NEGATIVE_INFINITY)).toBeCloseTo(-1, 9);
    expect(contact.constraintAtPoint(2.71, 2, -5)).toBe(-5);
  });

  it('a stock-top background holds the cutter at its nearest uncovered cell', () => {
    const uncovered = new Uint8Array(CELLS * CELLS);
    uncovered[5 * CELLS + 10] = 1; // cell spanning x 2.5..2.75, y 1.25..1.5
    const contact = field(meshMap(plane(0), uncovered), kernelForTool(BALL, MM_PER_CELL));
    const r = BALL.diameterMm / 2;
    const d = 0.3;
    const tip = contact.constraintAtPoint(2.75 + d, 1.4, Number.NEGATIVE_INFINITY);
    expect(tip).toBeCloseTo(-(r - Math.sqrt(r * r - d * d)), 9);
    expect(contact.constraintAtPoint(4.5, 4.5, Number.NEGATIVE_INFINITY)).toBeCloseTo(-4, 9);
  });
});

describe('mesh contact along a move', () => {
  it('keeps every triangle that can rise above the move, and answers as the full field', () => {
    fc.assert(
      fc.property(
        fc.array(triangle, { minLength: 1, maxLength: 10 }),
        point,
        point,
        (triangles, from, to) => {
          const kernel = kernelForTool(BALL, MM_PER_CELL);
          const contact = field(meshMap(triangles), kernel);
          const tolerance = 0.002;
          const along = contact.alongMove(from, to, tolerance);
          for (let s = 0; s <= 16; s += 1) {
            const t = s / 16;
            const x = from.x + t * (to.x - from.x);
            const y = from.y + t * (to.y - from.y);
            const z = from.z + t * (to.z - from.z);
            const full = contact.constraintAtPoint(x, y, z + tolerance);
            if (along === null) expect(full).toBeLessThanOrEqual(z + tolerance + 1e-9);
            else if (full > z + tolerance) expect(along(x, y, z + tolerance)).toBeCloseTo(full, 9);
          }
        },
      ),
      { numRuns: 120, seed: 5782 },
    );
  });
});
