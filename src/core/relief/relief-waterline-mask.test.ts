import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CNC_MASK_EMISSION_XY_CLEARANCE_MM,
  CNC_MASK_EMISSION_Z_CLEARANCE_MM,
} from '../cnc/precision';
import { partialCellEnd, partialCellStart } from '../grid';
import { buildToolpath, type CncPass, type Job } from '../job';
import type { CncTool } from '../scene';
import { computeRemovalGrid, kernelForTool } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { Heightmap } from './heightmap';
import { dilateHeightmapByTool } from './heightmap-tool-offset';
import { reliefFinishingPlan } from './relief-finishing-strategy';
import { reliefWaterlinePasses, type ReliefWaterlineOptions } from './relief-waterline';
import {
  BALL,
  ballKernel,
  CELL_MM,
  exactSurface,
  reachesIntoWall,
  sampledMap,
} from './relief-waterline.test-support';

// ADR-484: waterline passes on a masked relief circle its excluded stock like
// any other wall, and never enter it.

const END_MILL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 3.175 };

const OPTIONS: ReliefWaterlineOptions = {
  kernel: ballKernel(),
  steepAngleDeg: 45,
  levelStepMm: 0.4,
  wallOnRight: true,
  maxLinkMm: 6.35,
};

// A floor 3 mm down with a 5 mm square of stock left standing in the middle.
function squareIslandMap(): Heightmap {
  const map = sampledMap(60, () => -3);
  return withMask(map, (x, y) => Math.abs(x - 8.4) > 2.5 || Math.abs(y - 8.4) > 2.5);
}

function withMask(map: Heightmap, included: (x: number, y: number) => boolean): Heightmap {
  const inclusion = new Uint8Array(map.widthCells * map.heightCells);
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      inclusion[j * map.widthCells + i] = included((i + 0.5) * CELL_MM, (j + 0.5) * CELL_MM)
        ? 1
        : 0;
    }
  }
  return { ...map, inclusion };
}

function planned(map: Heightmap): ReturnType<typeof reliefWaterlinePasses> {
  return reliefWaterlinePasses(map, dilateHeightmapByTool(map, OPTIONS.kernel, 0), OPTIONS);
}

/**
 * The deepest any point of the passes (every 0.005 mm, vertices included)
 * reaches into excluded stock: how far its tip stands below the height the
 * dilation's stationary rule requires there (an output quantum above stock
 * top, a quantum further off in XY). Zero or less: clear.
 */
function deepestIntoStock(map: Heightmap, tool: CncTool, passes: ReadonlyArray<CncPass>): number {
  const radiusMm = tool.diameterMm / 2;
  const excluded = excludedRectangles(map);
  let deepest = Number.NEGATIVE_INFINITY;
  const probe = (x: number, y: number, z: number): void => {
    for (const cell of excluded) {
      const distance =
        Math.hypot(gap(x, cell.x0, cell.x1), gap(y, cell.y0, cell.y1)) -
        CNC_MASK_EMISSION_XY_CLEARANCE_MM;
      if (distance > radiusMm) continue;
      const needed =
        CNC_MASK_EMISSION_Z_CLEARANCE_MM - cuttingSurfaceDz(tool, Math.max(0, distance), radiusMm);
      deepest = Math.max(deepest, needed - z);
    }
  };
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    pass.points.forEach((from, index) => {
      probe(from.x, from.y, from.z);
      const to = pass.points[index + 1];
      if (to === undefined) return;
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.005);
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        probe(
          from.x + t * (to.x - from.x),
          from.y + t * (to.y - from.y),
          from.z + t * (to.z - from.z),
        );
      }
    });
  }
  return deepest;
}

type Rectangle = { x0: number; x1: number; y0: number; y1: number };

function excludedRectangles(map: Heightmap): ReadonlyArray<Rectangle> {
  const cells: Rectangle[] = [];
  for (let j = 0; j < map.heightCells; j += 1) {
    for (let i = 0; i < map.widthCells; i += 1) {
      if (map.inclusion?.[j * map.widthCells + i] !== 0) continue;
      cells.push({
        x0: partialCellStart(map, 'x', i),
        x1: partialCellEnd(map, 'x', i),
        y0: partialCellStart(map, 'y', j),
        y1: partialCellEnd(map, 'y', j),
      });
    }
  }
  return cells;
}

function gap(value: number, start: number, end: number): number {
  if (value < start) return start - value;
  return value > end ? value - end : 0;
}

function levelsOf(passes: ReadonlyArray<CncPass>): ReadonlyArray<number> {
  const levels = new Set<number>();
  for (const pass of passes) {
    if (pass.kind === 'path3d') for (const point of pass.points) levels.add(point.z);
  }
  return [...levels].sort((a, b) => b - a);
}

describe('masked waterline (ADR-484)', { timeout: 60_000 }, () => {
  it('circles excluded stock at every level down to the floor', () => {
    const passes = planned(squareIslandMap());

    // One stay-down pass down to the last level above the floor. It starts
    // at 0.8 mm: 0.4 mm down the ball stands clear of the stock on its tip's
    // rounded rim, which slopes at less than 45 degrees and so is the
    // raster's, as on any vertical wall.
    expect(passes).toHaveLength(1);
    const levels = levelsOf(passes);
    expect(levels).toHaveLength(6);
    expect(levels[0]).toBeCloseTo(-0.8, 9);
    expect(levels[levels.length - 1]).toBeCloseTo(-2.8, 9);
    // Deep down, the ball's full radius off the square's sides.
    const deepLevel = (passes[0]?.points ?? []).filter((point) => point.z < -2);
    const xs = deepLevel.map((point) => point.x);
    expect(Math.min(...xs)).toBeLessThan(8.4 - 2.52 - 1.5875 + 0.05);
    expect(Math.max(...xs)).toBeGreaterThan(8.4 + 2.52 + 1.5875 - 0.05);
  });

  it('never lets the cutter into excluded stock or the model', () => {
    const map = squareIslandMap();
    const passes = planned(map);

    expect(deepestIntoStock(map, BALL, passes)).toBeLessThanOrEqual(0);
    expect(reachesIntoWall(passes, exactSurface(map, OPTIONS.kernel), 0.0015)).toBe(false);
  });

  it('leaves the excluded stock whole in a simulated cut', () => {
    const map = squareIslandMap();
    const passes = reliefFinishingPlan(map, {
      tool: BALL,
      kernel: OPTIONS.kernel,
      scallopMm: 0.025,
      strategy: 'raster-waterline',
      rasterAxis: 'x',
      wallOnRight: true,
    });
    const simulated = computeRemovalGrid(
      buildToolpath(jobFor(BALL, passes), { startPoint: { x: 0, y: 0 } }),
      { originX: 0, originY: 0, widthMm: map.widthMm, heightMm: map.heightMm, mmPerCell: 0.07 },
      kernelForTool(BALL, 0.07),
    );
    if (simulated.kind === 'error') throw new Error(simulated.reason);
    const { grid } = simulated;
    let touched = 0;
    for (let row = 0; row < grid.heightCells; row += 1) {
      for (let col = 0; col < grid.widthCells; col += 1) {
        const x = (col + 0.5) * grid.mmPerCell;
        const y = (row + 0.5) * grid.mmPerCell;
        const inside = Math.abs(x - 8.4) < 2.52 && Math.abs(y - 8.4) < 2.52;
        if (inside && (grid.depth[row * grid.widthCells + col] ?? 0) !== 0) touched += 1;
      }
    }
    expect(touched).toBe(0);
  });

  it('keeps every move of every strategy out of random masks', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(
        fc.record({
          cx: fc.double({ min: 3, max: 11, noNaN: true }),
          cy: fc.double({ min: 3, max: 11, noNaN: true }),
          radius: fc.double({ min: 1, max: 5, noNaN: true }),
          // Excluded stock: a disc, or everything outside one.
          outside: fc.boolean(),
          wall: fc.double({ min: 0.5, max: 3, noNaN: true }),
        }),
        fc.constantFrom(BALL, END_MILL),
        fc.constantFrom<'x' | 'y'>('x', 'y'),
        (spec, tool, rasterAxis) => {
          // A boss with steep sides, so the model has walls of its own.
          const boss = sampledMap(50, (x, y) =>
            Math.max(-4, -1 - 3 * Math.max(0, Math.hypot(x - 7, y - 7) - spec.wall)),
          );
          const map = withMask(boss, (x, y) => {
            const inDisc = Math.hypot(x - spec.cx, y - spec.cy) < spec.radius;
            return spec.outside ? inDisc : !inDisc;
          });
          if (!map.inclusion?.includes(0) || !map.inclusion.includes(1)) return;
          const passes = reliefFinishingPlan(map, {
            tool,
            kernel: kernelForTool(tool, map.mmPerCell),
            scallopMm: 0.025,
            strategy: 'raster-waterline',
            rasterAxis,
            wallOnRight: true,
          });
          expect(deepestIntoStock(map, tool, passes)).toBeLessThanOrEqual(0);
        },
      ),
      { numRuns: 10, seed: 451 },
    );
  });
});

function jobFor(tool: CncTool, passes: ReadonlyArray<CncPass>): Job {
  return {
    groups: [
      {
        kind: 'cnc',
        layerId: 'mask-relief',
        color: '#804000',
        cutType: 'relief-finish',
        toolId: tool.id,
        toolName: tool.name,
        toolDiameterMm: tool.diameterMm,
        feedMmPerMin: 1000,
        plungeMmPerMin: 300,
        spindleRpm: 12_000,
        spindleSpinupSec: 0,
        safeZMm: 3,
        retractBetweenPasses: false,
        passes,
      },
    ],
  };
}
