import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { CncGroup, Job } from '../job';
import { cncGrblStrategy } from '../output';
import type { CncTiling } from '../scene';
import { tileJobs, type TiledJob } from './tile-plan';
import { REGISTRATION_HOLE_DEPTH_MM } from './tile-registration';

const TILE_SIZE_MM = 100;
const ORDINARY_OVERLAP_MM = 10;
const OVER_OVERLAP_MM = 120;
const DECIMAL_OVERLAP_MM = 0.137;
const EMITTED_COORDINATE_TOLERANCE_MM = 0.001;
const FLOATING_COMPARISON_TOLERANCE_MM = 1e-9;

function lineJob(
  start: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'L1',
    color: '#ff0000',
    cutType: 'engrave',
    toolDiameterMm: 3.175,
    feedMmPerMin: 1000,
    plungeMmPerMin: 300,
    spindleRpm: 12000,
    spindleSpinupSec: 3,
    safeZMm: 3.81,
    passes: [
      {
        kind: 'contour',
        zMm: -1,
        closed: false,
        polyline: [start, end],
      },
    ],
  };
  return { groups: [group] };
}

function readyTiledJobs(job: Job, overlapMm: number): ReadonlyArray<TiledJob> {
  const tiling: CncTiling = {
    tileWidthMm: TILE_SIZE_MM,
    tileHeightMm: TILE_SIZE_MM,
    overlapMm,
    registrationHoles: true,
  };
  const result = tileJobs(job, tiling);
  if (result.kind !== 'ready') throw new Error('expected materialized tile jobs');
  return result.tiles;
}

function stockHoleKeys(
  tiled: ReadonlyArray<TiledJob>,
  row: number,
  col: number,
): ReadonlyArray<string> {
  const entry = tiled.find(({ tile }) => tile.row === row && tile.col === col);
  if (entry === undefined) throw new Error('expected tile');
  const drill = entry.job.groups.find((group) => group.kind === 'cnc' && group.cutType === 'drill');
  if (drill?.kind !== 'cnc') throw new Error('registration group missing');
  return drill.passes.map((pass) => {
    if (pass.kind !== 'path3d') throw new Error('peck expected');
    const point = pass.points[0];
    if (point === undefined) throw new Error('peck point missing');
    expect(point.z).toBe(-REGISTRATION_HOLE_DEPTH_MM);
    return `${point.x + entry.tile.rect.minX},${point.y + entry.tile.rect.minY}`;
  });
}

function emittedStockHoles(
  tiled: ReadonlyArray<TiledJob>,
  row: number,
  col: number,
): ReadonlyArray<{ readonly x: number; readonly y: number }> {
  const entry = tiled.find(({ tile }) => tile.row === row && tile.col === col);
  if (entry === undefined) throw new Error('expected tile');
  const drill = entry.job.groups.find((group) => group.kind === 'cnc' && group.cutType === 'drill');
  if (drill?.kind !== 'cnc') throw new Error('registration group missing');
  const gcode = cncGrblStrategy.emit({ groups: [drill] }, DEFAULT_DEVICE_PROFILE);
  return [...gcode.matchAll(/G0 X(-?\d+\.\d+) Y(-?\d+\.\d+)\r?\nG1 Z-3\.000/g)].map((match) => ({
    x: Number(match[1]) + entry.tile.rect.minX,
    y: Number(match[2]) + entry.tile.rect.minY,
  }));
}

describe('tile registration', () => {
  it('keeps ordinary adjacent tile holes at identical stock positions', () => {
    const tiled = readyTiledJobs(lineJob({ x: 0, y: 50 }, { x: 190, y: 50 }), ORDINARY_OVERLAP_MM);

    expect(tiled).toHaveLength(2);
    expect(stockHoleKeys(tiled, 0, 0)).toEqual(stockHoleKeys(tiled, 0, 1));
  });

  it.each([TILE_SIZE_MM, OVER_OVERLAP_MM])(
    'shares stock-space holes after horizontal and vertical overlap normalization at %s mm',
    (overlapMm) => {
      const horizontal = readyTiledJobs(lineJob({ x: 0, y: 50 }, { x: 122, y: 50 }), overlapMm);
      const vertical = readyTiledJobs(lineJob({ x: 50, y: 0 }, { x: 50, y: 122 }), overlapMm);
      const horizontalFirst = stockHoleKeys(horizontal, 0, 0);
      const horizontalNext = stockHoleKeys(horizontal, 0, 1);
      const verticalFirst = stockHoleKeys(vertical, 0, 0);
      const verticalNext = stockHoleKeys(vertical, 1, 0);

      expect(horizontalFirst).toHaveLength(2);
      expect(horizontalNext).toEqual(expect.arrayContaining([...horizontalFirst]));
      expect(verticalFirst).toHaveLength(2);
      expect(verticalNext).toEqual(expect.arrayContaining([...verticalFirst]));
    },
  );

  it('keeps decimal registration pairs equal within emitted coordinate precision', () => {
    const tiled = readyTiledJobs(lineJob({ x: 0, y: 50 }, { x: 200, y: 50 }), DECIMAL_OVERLAP_MM);
    const first = emittedStockHoles(tiled, 0, 0);
    const next = emittedStockHoles(tiled, 0, 1);

    expect(first).toHaveLength(2);
    expect(next).toHaveLength(4);
    for (const hole of first) {
      expect(
        next.some(
          (candidate) =>
            Math.abs(candidate.x - hole.x) <=
              EMITTED_COORDINATE_TOLERANCE_MM + FLOATING_COMPARISON_TOLERANCE_MM &&
            Math.abs(candidate.y - hole.y) <=
              EMITTED_COORDINATE_TOLERANCE_MM + FLOATING_COMPARISON_TOLERANCE_MM,
        ),
      ).toBe(true);
    }
  });
});
