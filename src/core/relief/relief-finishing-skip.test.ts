import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { kernelForTool, type ToolKernel } from '../sim';
import type { Heightmap } from './heightmap';
import { reliefFinishingPlan } from './relief-finishing-strategy';
import { FINISHING_REDUCTION_TOLERANCE_MM, type FinishingPoint } from './relief-finishing-path';
import {
  finishedSkipFlags,
  linkFinishingRuns,
  type FinishingGrid,
  type FinishingRun,
} from './relief-finishing-skip';

// ADR-450: the finishing raster skips samples from which the cutter would
// touch only flats the roughing end mill finished, and links what it keeps.

const BALL: CncTool = { id: 'bn', name: '1/8 in ball nose', kind: 'ball-nose', diameterMm: 3.175 };
const CELL_MM = 0.25;
const FLOOR_MM = -3;

function grid(widthCells: number, heightCells: number, depth: Float32Array): FinishingGrid {
  return {
    widthCells,
    heightCells,
    depth,
    centerX: (col) => (col + 0.5) * CELL_MM,
    centerY: (row) => (row + 0.5) * CELL_MM,
  };
}

describe('finishedSkipFlags', () => {
  it('skips only where everything within reach is finished', () => {
    const width = 60;
    const height = 20;
    const depth = new Float32Array(width * height).fill(FLOOR_MM);
    // Columns 20-39 are finished floor; the rest still carries stock.
    const finishedAt = (x: number): number =>
      x > 20 * CELL_MM && x < 40 * CELL_MM ? FLOOR_MM : Number.NaN;
    const skip = finishedSkipFlags(grid(width, height, depth), finishedAt, [10], 1, CELL_MM);
    const row = [...skip.slice(10 * width, 11 * width)];
    // 1 mm is 4 cells, plus one cell of margin: 5 cells in from each side.
    expect(row.indexOf(1)).toBe(25);
    expect(row.lastIndexOf(1)).toBe(34);
    // Rows not emitted are never marked.
    expect(skip.slice(0, 10 * width).includes(1)).toBe(false);
  });

  it('keeps a sample whose reach holds a cell the flat level did not take to its height', () => {
    const width = 30;
    const depth = new Float32Array(width * width).fill(FLOOR_MM);
    depth[15 * width + 17] = FLOOR_MM + 0.2;
    const skip = finishedSkipFlags(grid(width, width, depth), () => FLOOR_MM, [15], 1, CELL_MM);
    expect(skip[15 * width + 12]).toBe(0);
    expect(skip[15 * width + 22]).toBe(0);
    expect(skip[15 * width + 5]).toBe(1);
  });
});

describe('linkFinishingRuns', () => {
  const run = (row: number, x0: number, x1: number, z = FLOOR_MM): FinishingRun => ({
    row,
    points: [
      { x: x0, y: row, z },
      { x: x1, y: row, z },
    ],
  });
  const flat = {
    tipAt: (_x: number, _y: number, lowerBound: number) => Math.max(lowerBound, FLOOR_MM),
  };

  it('stays down to the nearest run and enters it from its nearer end', () => {
    const chains = linkFinishingRuns([run(0, 0, 5), run(1, 0, 5)], (row) => row, flat, {
      maxLinkMm: 2,
      checkSpacingMm: 0.1,
    });
    expect(chains).toHaveLength(1);
    expect(chains[0]?.map((p) => p.x)).toEqual([0, 5, 5, 0]);
  });

  it('lifts to a run farther than the link length', () => {
    const chains = linkFinishingRuns([run(0, 0, 5), run(8, 0, 5)], (row) => row, flat, {
      maxLinkMm: 2,
      checkSpacingMm: 0.1,
    });
    expect(chains).toHaveLength(2);
  });

  it('hops over the highest tip along the link', () => {
    const bump = {
      tipAt: (x: number, _y: number, lowerBound: number) =>
        Math.max(lowerBound, x > 1 && x < 2 ? -1 : FLOOR_MM),
    };
    const chains = linkFinishingRuns(
      [
        { row: 0, points: [{ x: 0, y: 0, z: FLOOR_MM }] },
        { row: 0, points: [{ x: 3, y: 0, z: FLOOR_MM }] },
      ],
      () => 0,
      bump,
      { maxLinkMm: 5, checkSpacingMm: 0.1 },
    );
    expect(chains[0]).toEqual([
      { x: 0, y: 0, z: FLOOR_MM },
      { x: 0, y: 0, z: -1 },
      { x: 3, y: 0, z: -1 },
      { x: 3, y: 0, z: FLOOR_MM },
    ]);
  });
});

// A floor with a dome standing on it, 30 x 20 mm.
function domeMap(cx: number, cy: number, radiusMm: number): Heightmap {
  const width = Math.round(30 / CELL_MM);
  const height = Math.round(20 / CELL_MM);
  const depth = new Float32Array(width * height);
  for (let j = 0; j < height; j += 1) {
    for (let i = 0; i < width; i += 1) {
      const r = Math.hypot((i + 0.5) * CELL_MM - cx, (j + 0.5) * CELL_MM - cy);
      depth[j * width + i] =
        r < radiusMm ? FLOOR_MM + 2 * Math.sqrt(1 - (r / radiusMm) ** 2) : FLOOR_MM;
    }
  }
  return {
    widthCells: width,
    heightCells: height,
    widthMm: 30,
    heightMm: 20,
    mmPerCell: CELL_MM,
    depth,
  };
}

// Every floor cell farther than `clearMm` from the dome counts as finished.
function floorFinishedAt(map: Heightmap, cx: number, cy: number, clearMm: number) {
  return (x: number, y: number): number =>
    Math.hypot(x - cx, y - cy) > clearMm && x >= 0 && y >= 0 && x < map.widthMm && y < map.heightMm
      ? FLOOR_MM
      : Number.NaN;
}

// Stamps the ball along every pass onto `stock`, lowering it where it cuts.
function stamp(
  stock: Float32Array,
  map: Heightmap,
  kernel: ToolKernel,
  passes: ReadonlyArray<CncPass>,
) {
  const at = (p: FinishingPoint): void => {
    const r = kernel.radiusMm;
    for (
      let j = Math.max(0, Math.floor((p.y - r) / CELL_MM));
      j <= Math.min(map.heightCells - 1, Math.ceil((p.y + r) / CELL_MM));
      j += 1
    ) {
      for (
        let i = Math.max(0, Math.floor((p.x - r) / CELL_MM));
        i <= Math.min(map.widthCells - 1, Math.ceil((p.x + r) / CELL_MM));
        i += 1
      ) {
        const d = Math.hypot((i + 0.5) * CELL_MM - p.x, (j + 0.5) * CELL_MM - p.y);
        if (d > r) continue;
        const index = j * map.widthCells + i;
        stock[index] = Math.min(stock[index] ?? 0, p.z + kernel.surfaceDzAtRadius(d));
      }
    }
  };
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    pass.points.forEach((a, index) => {
      const b = pass.points[index + 1] ?? a;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (CELL_MM / 4)));
      for (let s = 0; s <= steps; s += 1) {
        const t = s / steps;
        at({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
      }
    });
  }
}

describe('a finishing raster that skips finished flats', () => {
  const kernel = kernelForTool(BALL, CELL_MM);

  // Every plan checks each move against the exact contact (ADR-421 Amd 1).
  it('leaves the stock the full raster leaves, with less path', { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(
        fc.double({ min: 8, max: 22, noNaN: true }),
        fc.double({ min: 6, max: 14, noNaN: true }),
        fc.double({ min: 2, max: 5, noNaN: true }),
        fc.constantFrom<'x' | 'y'>('x', 'y'),
        (cx, cy, radiusMm, axis) => {
          const map = domeMap(cx, cy, radiusMm);
          const finishedAt = floorFinishedAt(map, cx, cy, radiusMm + 2);
          // Before finishing: the finished floor at its height, 0.5 mm of
          // stock everywhere else.
          const start = map.depth.map((z, index) => {
            const x = ((index % map.widthCells) + 0.5) * CELL_MM;
            const y = (Math.floor(index / map.widthCells) + 0.5) * CELL_MM;
            return Number.isNaN(finishedAt(x, y)) ? z + 0.5 : z;
          });
          const plan = (withSkip: boolean): ReadonlyArray<CncPass> =>
            reliefFinishingPlan(map, {
              tool: BALL,
              kernel,
              scallopMm: 0.02,
              strategy: 'raster',
              rasterAxis: axis,
              wallOnRight: true,
              ...(withSkip ? { finishedAt } : {}),
            });
          const fullPlan = plan(false);
          const skipPlan = plan(true);
          const full = start.slice();
          const skipped = start.slice();
          stamp(full, map, kernel, fullPlan);
          stamp(skipped, map, kernel, skipPlan);
          // The runs are reduced apart from the rows they came from, and each
          // reduction may leave its own tolerance of stock.
          let worst = 0;
          for (let index = 0; index < full.length; index += 1) {
            worst = Math.max(worst, Math.abs((full[index] ?? 0) - (skipped[index] ?? 0)));
          }
          expect(worst).toBeLessThanOrEqual(FINISHING_REDUCTION_TOLERANCE_MM + 1e-6);
          expect(pathLength(skipPlan)).toBeLessThan(pathLength(fullPlan));
        },
      ),
      { numRuns: 6, seed: 450 },
    );
  });
});

function pathLength(passes: ReadonlyArray<CncPass>): number {
  let length = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    pass.points.forEach((a, index) => {
      const b = pass.points[index + 1];
      if (b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
    });
  }
  return length;
}
