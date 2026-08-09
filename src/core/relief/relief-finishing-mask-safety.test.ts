import { describe, expect, it } from 'vitest';
import { buildToolpath, type CncPass, type Job } from '../job';
import { partialCellEnd, partialCellIndex, partialCellStart } from '../grid';
import { computeRemovalGrid, kernelForTool, type ToolKernel } from '../sim';
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
      stepoverPercent: 40,
    });
    const horizontal = passes.find((pass) => !isVerticalPass(pass));
    if (horizontal?.kind !== 'path3d') throw new Error('interior finishing row expected');
    const last = horizontal.points.at(-1);

    const excludedBoundaryX = 20 * map.mmPerCell;
    expect((last?.x ?? 0) + tool.diameterMm / 2).toBeLessThan(excludedBoundaryX);
    expect(horizontal.points.some((point) => Math.abs(point.x - 2.5) < 1e-9)).toBe(false);
  });

  it('keeps ball-nose mask-boundary samples vertical while preserving interior rows', () => {
    const tool: CncTool = { id: 'mask-ball', name: 'mask ball', kind: 'ball-nose', diameterMm: 2 };
    const map = maskedRow();
    const kernel = kernelForTool(tool, map.mmPerCell);
    const passes = reliefFinishingPasses(map, {
      tool,
      kernel,
      scallopMm: 0.025,
      stepoverPercent: 40,
    });
    const verticalBoundaryPasses = passes.filter(
      (pass) => isVerticalPass(pass) && passTouchesExcluded(pass, map, kernel),
    );

    expect(verticalBoundaryPasses.length).toBeGreaterThan(0);
    for (const pass of passes) {
      if (pass.kind !== 'path3d' || isVerticalPass(pass)) continue;
      expect(
        pass.points.every((point) => !kernelTouchesExcluded(map, kernel, point.x, point.y)),
      ).toBe(true);
    }

    const simulated = computeRemovalGrid(
      buildToolpath(jobFor(tool, passes), { startPoint: { x: 0.1, y: 0.1 } }),
      { originX: 0, originY: 0, widthMm: 3, heightMm: 0.2, mmPerCell: 0.2 },
      kernel,
    );
    if (simulated.kind === 'error') throw new Error(simulated.reason);
    expect([...simulated.grid.depth.slice(12)]).toEqual([0, 0, 0]);
  });

  it('keeps every fractional-grid chord capsule outside concave, diagonal, and island masks', () => {
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
      stepoverPercent: 40,
    });

    expect(passes.some(isRightToLeftPass)).toBe(true);
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

function passTouchesExcluded(pass: FinishingPass, map: Heightmap, kernel: ToolKernel): boolean {
  if (pass.kind !== 'path3d') return false;
  const target = pass.points.at(-1);
  return (
    target !== undefined && kernelTouchesExcluded(map, kernel, target.x, target.y) && target.z < 0
  );
}

function kernelTouchesExcluded(map: Heightmap, kernel: ToolKernel, x: number, y: number): boolean {
  const centerX = partialCellIndex(map, 'x', x);
  const centerY = partialCellIndex(map, 'y', y);
  if (centerX === null || centerY === null) return false;
  return (kernel.maskCellOffsets ?? kernel.offsets).some(({ dx, dy }) => {
    const cellX = centerX + dx;
    const cellY = centerY + dy;
    if (cellX < 0 || cellY < 0 || cellX >= map.widthCells || cellY >= map.heightCells) {
      return false;
    }
    return map.inclusion?.[cellY * map.widthCells + cellX] === 0;
  });
}

function isRightToLeftPass(pass: FinishingPass): boolean {
  if (pass.kind !== 'path3d') return false;
  const first = pass.points[0];
  const last = pass.points.at(-1);
  return first !== undefined && last !== undefined && first.x > last.x;
}

function expectMaskedPassesSafe(
  map: Heightmap,
  tool: CncTool,
  passes: ReadonlyArray<FinishingPass>,
): void {
  const excluded = excludedCells(map);
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    for (const point of pass.points) expectStationaryPointSafe(map, tool, excluded, point);
    for (let index = 1; index < pass.points.length; index += 1) {
      const from = pass.points[index - 1];
      const to = pass.points[index];
      if (from === undefined || to === undefined || (from.x === to.x && from.y === to.y)) continue;
      expect(from.y).toBeCloseTo(to.y, 12);
      for (const cell of excluded) {
        expect(
          horizontalSegmentDistanceToCell(map, from.x, to.x, from.y, cell),
        ).toBeGreaterThanOrEqual(tool.diameterMm / 2 - 1e-9);
      }
    }
  }
}

type Point3 = { readonly x: number; readonly y: number; readonly z: number };

function expectStationaryPointSafe(
  map: Heightmap,
  tool: CncTool,
  excluded: ReadonlyArray<number>,
  point: Point3,
): void {
  if (point.z >= 0) return;
  const radiusMm = tool.diameterMm / 2;
  for (const cell of excluded) {
    const distanceMm = pointDistanceToCell(map, point.x, point.y, cell);
    if (distanceMm > radiusMm) continue;
    expect(point.z + cuttingSurfaceDz(tool, distanceMm, radiusMm)).toBeGreaterThanOrEqual(-1e-9);
  }
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

function horizontalSegmentDistanceToCell(
  map: Heightmap,
  fromX: number,
  toX: number,
  y: number,
  cell: number,
): number {
  const bounds = cellBounds(map, cell);
  const minX = Math.min(fromX, toX);
  const maxX = Math.max(fromX, toX);
  const gapX = Math.max(0, bounds.minX - maxX, minX - bounds.maxX);
  return Math.hypot(gapX, axisGap(y, bounds.minY, bounds.maxY));
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
