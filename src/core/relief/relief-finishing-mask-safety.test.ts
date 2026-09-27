import { describe, expect, it } from 'vitest';
import { buildToolpath, type CncPass, type Job } from '../job';
import { partialCellEnd, partialCellStart } from '../grid';
import { computeRemovalGrid, kernelForTool } from '../sim';
import { cuttingSurfaceDz } from '../sim/cutting-surface';
import type { CncTool } from '../scene';
import type { Heightmap } from './heightmap';
import { reliefFinishingPasses } from './relief-finishing';

describe('relief finishing mask sweep safety', () => {
  it('ends a flat-tool scanline before its interpolated chord enters excluded stock', () => {
    const tool: CncTool = { id: 'mask-flat', name: 'mask flat', kind: 'end-mill', diameterMm: 2 };
    const map = fractionalMaskedRow();
    const passes = reliefFinishingPasses(map, {
      tool,
      kernel: kernelForTool(tool, map.mmPerCell),
      scallopMm: 0.025,
    });
    const horizontal = passes.find((pass) => !isVerticalPass(pass));
    if (horizontal?.kind !== 'path3d') throw new Error('interior finishing row expected');
    const last = horizontal.points.at(-1);

    const excludedBoundaryX = 20 * map.mmPerCell;
    expect((last?.x ?? 0) + tool.diameterMm / 2).toBeLessThan(excludedBoundaryX);
    expect(horizontal.points.some((point) => Math.abs(point.x - 2.5) < 1e-9)).toBe(false);
  });

  it('rides a ball-nose row up to the mask and leaves the excluded stock whole', () => {
    const tool: CncTool = { id: 'mask-ball', name: 'mask ball', kind: 'ball-nose', diameterMm: 2 };
    const map = maskedRow();
    const kernel = kernelForTool(tool, map.mmPerCell);
    const passes = reliefFinishingPasses(map, {
      tool,
      kernel,
      scallopMm: 0.025,
    });

    // ADR-484: one stay-down row, not a plunge per sample near the mask.
    expect(passes.filter((pass) => !isVerticalPass(pass))).toHaveLength(1);
    expect(passes.filter(isVerticalPass)).toHaveLength(0);
    expectMaskedPassesSafe(map, tool, passes);

    const simulated = computeRemovalGrid(
      buildToolpath(jobFor(tool, passes), { startPoint: { x: 0.1, y: 0.1 } }),
      { originX: 0, originY: 0, widthMm: 3, heightMm: 0.2, mmPerCell: 0.2 },
      kernel,
    );
    if (simulated.kind === 'error') throw new Error(simulated.reason);
    expect([...simulated.grid.depth.slice(12)]).toEqual([0, 0, 0]);
  });

  it('links the rows inside a round mask into one stay-down pass', () => {
    const tool: CncTool = { id: 'disc-ball', name: 'disc ball', kind: 'ball-nose', diameterMm: 1 };
    const map = discMask();
    const kernel = kernelForTool(tool, map.mmPerCell);
    const passes = reliefFinishingPasses(map, { tool, kernel, scallopMm: 0.025 });

    // ADR-484: every row and every lone edge sample on one pass, the links
    // between them checked against the stock like the rows.
    expect(passes).toHaveLength(1);
    expect(passes.filter(isVerticalPass)).toHaveLength(0);
    expectMaskedPassesSafe(map, tool, passes);

    const simulated = computeRemovalGrid(
      buildToolpath(jobFor(tool, passes), { startPoint: { x: 0, y: 0 } }),
      { originX: 0, originY: 0, widthMm: map.widthMm, heightMm: map.heightMm, mmPerCell: 0.05 },
      kernelForTool(tool, 0.05),
    );
    if (simulated.kind === 'error') throw new Error(simulated.reason);
    const { grid } = simulated;
    let cutOutside = 0;
    let cutInside = 0;
    for (let row = 0; row < grid.heightCells; row += 1) {
      for (let col = 0; col < grid.widthCells; col += 1) {
        const cell = Math.floor(row / 4) * map.widthCells + Math.floor(col / 4);
        const cut = (grid.depth[row * grid.widthCells + col] ?? 0) < 0;
        if (map.inclusion?.[cell] === 0) cutOutside += cut ? 1 : 0;
        else cutInside += cut ? 1 : 0;
      }
    }
    expect(cutOutside).toBe(0);
    expect(cutInside).toBeGreaterThan(0);
  });

  it('keeps every move out of concave, diagonal, and island masks', () => {
    const tool: CncTool = {
      id: 'complex-mask-ball',
      name: 'complex mask ball',
      kind: 'ball-nose',
      diameterMm: 2,
    };
    const map = complexMask();
    const kernel = kernelForTool(tool, map.mmPerCell);
    const passes = reliefFinishingPasses(map, {
      tool,
      kernel,
      scallopMm: 0.025,
    });

    expect(passes.some(hasRightToLeftMove)).toBe(true);
    expect(
      passes.some(
        (pass) =>
          pass.kind === 'path3d' &&
          pass.points.some(
            (point) => Math.abs(point.y - (map.heightCells - 0.5) * map.mmPerCell) < 1e-9,
          ),
      ),
    ).toBe(true);
    expectMaskedPassesSafe(map, tool, passes);
  });
});

type FinishingPass = ReturnType<typeof reliefFinishingPasses>[number];

function maskedRow(): Heightmap {
  return {
    widthCells: 15,
    heightCells: 1,
    widthMm: 3,
    heightMm: 0.2,
    mmPerCell: 0.2,
    depth: new Float32Array(15).fill(-2),
    inclusion: Uint8Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0]),
  };
}

// A bowl 2 mm deep, excluded outside a 2.4 mm circle.
function discMask(): Heightmap {
  const cells = 30;
  const depth = new Float32Array(cells * cells);
  const inclusion = new Uint8Array(cells * cells);
  for (let row = 0; row < cells; row += 1) {
    for (let col = 0; col < cells; col += 1) {
      const r = Math.hypot((col + 0.5) * 0.2 - 3, (row + 0.5) * 0.2 - 3);
      depth[row * cells + col] = -2 + 0.2 * r;
      inclusion[row * cells + col] = r < 2.4 ? 1 : 0;
    }
  }
  return {
    widthCells: cells,
    heightCells: cells,
    widthMm: 6,
    heightMm: 6,
    mmPerCell: 0.2,
    depth,
    inclusion,
  };
}

function fractionalMaskedRow(): Heightmap {
  const widthCells = 24;
  const inclusion = new Uint8Array(widthCells).fill(1);
  inclusion.fill(0, 20);
  return {
    widthCells,
    heightCells: 1,
    widthMm: widthCells / 5.8,
    heightMm: 1 / 5.8,
    mmPerCell: 1 / 5.8,
    depth: new Float32Array(widthCells).fill(-2),
    inclusion,
  };
}

function complexMask(): Heightmap {
  const widthCells = 30;
  const heightCells = 12;
  const inclusion = new Uint8Array(widthCells * heightCells).fill(1);
  for (let row = 0; row < heightCells; row += 1) {
    for (let col = 0; col < widthCells; col += 1) {
      if (isComplexExcluded(row, col)) {
        inclusion[row * widthCells + col] = 0;
      }
    }
  }
  return {
    widthCells,
    heightCells,
    widthMm: widthCells / 5.8,
    heightMm: heightCells / 5.8,
    mmPerCell: 1 / 5.8,
    depth: new Float32Array(widthCells * heightCells).fill(-2),
    inclusion,
  };
}

function isComplexExcluded(row: number, col: number): boolean {
  const rightWall = col >= 24;
  const concaveStep = row >= 6 && col >= 19;
  const diagonal = row >= 2 && row <= 5 && col === row + 10;
  const alternatingIsland = row === 3 && col >= 14 && col <= 18 && col % 2 === 0;
  return rightWall || concaveStep || diagonal || alternatingIsland;
}

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

function isVerticalPass(pass: FinishingPass): boolean {
  if (pass.kind !== 'path3d') return false;
  const first = pass.points[0];
  const last = pass.points.at(-1);
  if (first === undefined || last === undefined) return false;
  return first.x === last.x && first.y === last.y;
}

function hasRightToLeftMove(pass: FinishingPass): boolean {
  if (pass.kind !== 'path3d') return false;
  return pass.points.some((to, index) => {
    const from = pass.points[index - 1];
    return from !== undefined && from.y === to.y && from.x > to.x;
  });
}

// Every vertex, and every point along every move (0.001 mm apart), stands
// clear of every excluded cell's whole rectangle at stock top.
function expectMaskedPassesSafe(
  map: Heightmap,
  tool: CncTool,
  passes: ReadonlyArray<FinishingPass>,
): void {
  const excluded = excludedCells(map);
  let deepest = Number.NEGATIVE_INFINITY;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (const point of pass.points) {
      deepest = Math.max(deepest, depthIntoStock(map, tool, excluded, point));
    }
    for (let index = 1; index < pass.points.length; index += 1) {
      const from = pass.points[index - 1];
      const to = pass.points[index];
      if (from === undefined || to === undefined || (from.x === to.x && from.y === to.y)) continue;
      // Only the cells within the cutter's reach of the move can matter.
      const near = excluded.filter(
        (cell) => boxGapToCell(map, from, to, cell) <= tool.diameterMm / 2,
      );
      const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / 0.001);
      for (let step = 1; step < steps; step += 1) {
        const t = step / steps;
        const point = {
          x: from.x + t * (to.x - from.x),
          y: from.y + t * (to.y - from.y),
          z: from.z + t * (to.z - from.z),
        };
        deepest = Math.max(deepest, depthIntoStock(map, tool, near, point));
      }
    }
  }
  expect(deepest).toBeLessThanOrEqual(1e-9);
}

// A lower bound on the distance from a move to a cell: the distance between
// their bounding boxes.
function boxGapToCell(map: Heightmap, from: Point3, to: Point3, cell: number): number {
  const bounds = cellBounds(map, cell);
  const gapX = Math.max(
    0,
    bounds.minX - Math.max(from.x, to.x),
    Math.min(from.x, to.x) - bounds.maxX,
  );
  const gapY = Math.max(
    0,
    bounds.minY - Math.max(from.y, to.y),
    Math.min(from.y, to.y) - bounds.maxY,
  );
  return Math.hypot(gapX, gapY);
}

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

// How far the cutter standing at `point` reaches below stock top into the
// nearest-reaching excluded cell; -Infinity when none is in reach.
function depthIntoStock(
  map: Heightmap,
  tool: CncTool,
  excluded: ReadonlyArray<number>,
  point: Point3,
): number {
  if (point.z >= 0) return Number.NEGATIVE_INFINITY;
  const radiusMm = tool.diameterMm / 2;
  let deepest = Number.NEGATIVE_INFINITY;
  for (const cell of excluded) {
    const distanceMm = pointDistanceToCell(map, point.x, point.y, cell);
    if (distanceMm > radiusMm) continue;
    deepest = Math.max(deepest, -(point.z + cuttingSurfaceDz(tool, distanceMm, radiusMm)));
  }
  return deepest;
}

function excludedCells(map: Heightmap): ReadonlyArray<number> {
  const cells: number[] = [];
  for (let index = 0; index < map.depth.length; index += 1) {
    if (map.inclusion?.[index] === 0) cells.push(index);
  }
  return cells;
}

function pointDistanceToCell(map: Heightmap, x: number, y: number, cell: number): number {
  const bounds = cellBounds(map, cell);
  return Math.hypot(axisGap(x, bounds.minX, bounds.maxX), axisGap(y, bounds.minY, bounds.maxY));
}

function cellBounds(map: Heightmap, cell: number) {
  const col = cell % map.widthCells;
  const row = Math.floor(cell / map.widthCells);
  return {
    minX: partialCellStart(map, 'x', col),
    maxX: partialCellEnd(map, 'x', col),
    minY: partialCellStart(map, 'y', row),
    maxY: partialCellEnd(map, 'y', row),
  };
}

function axisGap(value: number, min: number, max: number): number {
  if (value < min) return min - value;
  return value > max ? value - max : 0;
}
