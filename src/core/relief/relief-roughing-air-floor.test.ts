import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncPass } from '../job';
import type { CncTool } from '../scene';
import { kernelForTool } from '../sim';
import type { Heightmap } from './heightmap';
import { reliefRoughingLadder, type ReliefRoughingOptions } from './relief-roughing';
import { reliefRoughingMotion } from './relief-roughing-motion';

// ADR-489: a roughing pass's air floor is proven by the job's own earlier
// cuts. Cutting every earlier pass in a stock simulation must leave nothing
// the cutter would touch with its tip at the floor, anywhere on the pass.

const END_MILL: CncTool = { id: 'em', name: 'end mill', kind: 'end-mill', diameterMm: 3.175 };
const BALL: CncTool = { id: 'bn', name: 'ball nose', kind: 'ball-nose', diameterMm: 3.175 };
const V_BIT: CncTool = {
  id: 'v',
  name: 'v-bit',
  kind: 'v-bit',
  diameterMm: 6.35,
  tipAngleDeg: 90,
};

type Point = { readonly x: number; readonly y: number; readonly z: number };

// Stock heights on a grid finer than the relief's, 0 = uncut stock top.
type Stock = {
  readonly cellMm: number;
  readonly width: number;
  readonly height: number;
  readonly top: Float64Array;
};

type Report = { readonly floored: number; readonly worstMm: number };

function mapOf(
  widthMm: number,
  heightMm: number,
  mmPerCell: number,
  depthAt: (x: number, y: number) => number,
): Heightmap {
  const widthCells = Math.round(widthMm / mmPerCell);
  const heightCells = Math.round(heightMm / mmPerCell);
  const depth = new Float32Array(widthCells * heightCells);
  for (let j = 0; j < heightCells; j += 1) {
    for (let i = 0; i < widthCells; i += 1) {
      depth[j * widthCells + i] = depthAt((i + 0.5) * mmPerCell, (j + 0.5) * mmPerCell);
    }
  }
  return { widthCells, heightCells, widthMm, heightMm, mmPerCell, depth };
}

// A dome and a plateau with steep sides on a floor 10 mm down.
function domeAndPlateau(mmPerCell: number): Heightmap {
  return mapOf(60, 40, mmPerCell, (x, y) => {
    const d = Math.hypot(x - 20, y - 20);
    const dome = d < 14 ? -10 + 8 * Math.sqrt(1 - (d / 14) ** 2) : -10;
    const inside = Math.min(x - 38, 54 - x, y - 10, 30 - y);
    const plateau = inside > 0 ? Math.max(-10, -4 - 3 * Math.max(0, 2 - inside)) : -10;
    return Math.max(dome, plateau);
  });
}

function bumps(
  mmPerCell: number,
  floorMm: number,
  peaks: ReadonlyArray<{ x: number; y: number; h: number; r: number }>,
): Heightmap {
  return mapOf(24, 24, mmPerCell, (x, y) => {
    let z = -floorMm;
    for (const peak of peaks) {
      z = Math.max(
        z,
        -floorMm + peak.h * Math.exp(-((Math.hypot(x - peak.x, y - peak.y) / peak.r) ** 2)),
      );
    }
    return Math.min(0, z);
  });
}

function passPoints(pass: CncPass): ReadonlyArray<Point> {
  if (pass.kind === 'contour') return pass.polyline.map((point) => ({ ...point, z: pass.zMm }));
  if (pass.kind === 'path3d') return pass.points;
  return [];
}

function distanceToSegment(x: number, y: number, a: Point, b: Point): number {
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const length2 = ex * ex + ey * ey;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - a.x) * ex + (y - a.y) * ey) / length2)) : 0;
  return Math.hypot(x - a.x - t * ex, y - a.y - t * ey);
}

// Every stock cell whose centre lies within `radiusMm` of segment ab, with
// that distance.
function forCellsNear(
  stock: Stock,
  a: Point,
  b: Point,
  radiusMm: number,
  visit: (index: number, distanceMm: number) => void,
): void {
  const { cellMm } = stock;
  const minI = Math.max(0, Math.floor((Math.min(a.x, b.x) - radiusMm) / cellMm));
  const maxI = Math.min(stock.width - 1, Math.ceil((Math.max(a.x, b.x) + radiusMm) / cellMm));
  const minJ = Math.max(0, Math.floor((Math.min(a.y, b.y) - radiusMm) / cellMm));
  const maxJ = Math.min(stock.height - 1, Math.ceil((Math.max(a.y, b.y) + radiusMm) / cellMm));
  for (let j = minJ; j <= maxJ; j += 1) {
    for (let i = minI; i <= maxI; i += 1) {
      const distance = distanceToSegment((i + 0.5) * cellMm, (j + 0.5) * cellMm, a, b);
      if (distance <= radiusMm) visit(j * stock.width + i, distance);
    }
  }
}

// Cut the passes in order, each segment swept exactly at the higher of its
// ends' heights (so a ramp cuts no more here than it really does). Before
// each pass with a floor, measure how far any stock cell stands above the
// cutter held at the floor anywhere on the pass's path: the nearest point of
// a segment is where the cutter reaches lowest over a cell.
function simulate(map: Heightmap, tool: CncTool, passes: ReadonlyArray<CncPass>): Report {
  const cellMm = map.mmPerCell / 2;
  const width = Math.ceil(map.widthMm / cellMm);
  const height = Math.ceil(map.heightMm / cellMm);
  const stock: Stock = { cellMm, width, height, top: new Float64Array(width * height) };
  const law = kernelForTool(tool, map.mmPerCell);
  const radius = law.radiusMm;
  let floored = 0;
  let worstMm = Number.NEGATIVE_INFINITY;
  for (const pass of passes) {
    const points = passPoints(pass);
    const floor = pass.kind === 'contour' || pass.kind === 'path3d' ? pass.airFloorZMm : undefined;
    if (floor !== undefined) {
      floored += 1;
      points.forEach((a, index) => {
        const b = points[index + 1] ?? a;
        forCellsNear(stock, a, b, radius, (cell, distance) => {
          const clear = floor + law.surfaceDzAtRadius(distance);
          worstMm = Math.max(worstMm, (stock.top[cell] ?? 0) - clear);
        });
      });
    }
    points.forEach((a, index) => {
      const b = points[index + 1] ?? a;
      const z = Math.max(a.z, b.z);
      forCellsNear(stock, a, b, radius, (cell, distance) => {
        stock.top[cell] = Math.min(stock.top[cell] ?? 0, z + law.surfaceDzAtRadius(distance));
      });
    });
  }
  return { floored, worstMm };
}

function roughAndCheck(
  map: Heightmap,
  options: ReliefRoughingOptions,
  rampAngleDeg?: number,
): Report {
  const ladder = reliefRoughingLadder(map, options);
  const passes = reliefRoughingMotion(ladder.levels, {
    stockOnRight: true,
    cutWidthMm: ladder.cutWidthMm,
    ...(rampAngleDeg === undefined ? {} : { rampAngleDeg }),
  });
  return simulate(map, options.tool, passes);
}

describe('relief roughing air floors (ADR-489)', () => {
  const base = { reliefDepthMm: 10, depthPerPassMm: 1.5, stepoverPercent: 40 };

  it.each([
    ['end mill', END_MILL, {}],
    ['end mill, ramped in', END_MILL, { ramp: 3 }],
    ['end mill with slope steps and flats', END_MILL, { fineStepMm: 0.5, finishFlats: true }],
    ['ball nose', BALL, {}],
    ['ball nose at 90% stepover', BALL, { stepoverPercent: 90 }],
    ['90 degree V-bit', V_BIT, {}],
  ] as const)('holds on a dome and plateau: %s', (_name, tool, extra) => {
    const map = domeAndPlateau(tool.diameterMm / 8);
    const { ramp, ...settings } = { ramp: undefined, ...extra };
    const report = roughAndCheck(map, { ...base, ...settings, tool }, ramp);
    expect(report.floored).toBeGreaterThan(0);
    expect(report.worstMm).toBeLessThanOrEqual(1e-6);
  });

  it('holds inside a mask outline, whose excluded stock stays standing', () => {
    const map = domeAndPlateau(END_MILL.diameterMm / 8);
    const inclusion = new Uint8Array(map.widthCells * map.heightCells);
    for (let j = 0; j < map.heightCells; j += 1) {
      for (let i = 0; i < map.widthCells; i += 1) {
        const x = ((i + 0.5) * map.mmPerCell - 30) / 26;
        const y = ((j + 0.5) * map.mmPerCell - 20) / 17;
        inclusion[j * map.widthCells + i] = x * x + y * y <= 1 ? 1 : 0;
      }
    }
    for (const tool of [END_MILL, BALL]) {
      const report = roughAndCheck({ ...map, inclusion }, { ...base, tool }, 3);
      expect(report.floored).toBeGreaterThan(0);
      expect(report.worstMm).toBeLessThanOrEqual(1e-6);
    }
  });

  it('holds on random bumps for every bit (15 seeds)', { timeout: 60_000 }, () => {
    const peak = fc.record({
      x: fc.integer({ min: 3, max: 21 }),
      y: fc.integer({ min: 3, max: 21 }),
      h: fc.integer({ min: 1, max: 8 }),
      r: fc.integer({ min: 2, max: 9 }),
    });
    fc.assert(
      fc.property(
        fc.array(peak, { minLength: 1, maxLength: 3 }),
        fc.constantFrom(END_MILL, BALL, V_BIT),
        fc.integer({ min: 15, max: 95 }),
        fc.constantFrom(0.8, 1.5, 3),
        fc.record({
          fineStepMm: fc.option(fc.constantFrom(0.4, 0.8), { nil: undefined }),
          finishFlats: fc.boolean(),
          ramp: fc.option(fc.constant(3), { nil: undefined }),
        }),
        (peaks, tool, stepoverPercent, depthPerPassMm, extra) => {
          const map = bumps(tool.diameterMm / 8, 8, peaks);
          const report = roughAndCheck(
            map,
            {
              tool,
              reliefDepthMm: 8,
              depthPerPassMm,
              stepoverPercent,
              finishFlats: extra.finishFlats,
              ...(extra.fineStepMm === undefined ? {} : { fineStepMm: extra.fineStepMm }),
            },
            extra.ramp,
          );
          expect(report.worstMm).toBeLessThanOrEqual(1e-6);
        },
      ),
      { numRuns: 15 },
    );
  });

  it('gives the first level no floor, since it starts at the uncut stock top', () => {
    const map = domeAndPlateau(END_MILL.diameterMm / 8);
    const ladder = reliefRoughingLadder(map, { ...base, tool: END_MILL });
    expect(ladder.levels[0]?.airFloorZMm).toBeUndefined();
    const floors = ladder.levels.map((level) => level.airFloorZMm);
    expect(floors.slice(1).every((floor) => floor !== undefined)).toBe(true);
    // An end mill's floor is its slice top; a ball nose's stands its radius higher.
    expect(ladder.levels[1]?.airFloorZMm).toBe(ladder.levels[1]?.sliceTopMm);
    const ball = reliefRoughingLadder(domeAndPlateau(BALL.diameterMm / 8), { ...base, tool: BALL });
    const second = ball.levels[1];
    expect(second?.airFloorZMm).toBeCloseTo((second?.sliceTopMm ?? 0) + BALL.diameterMm / 2, 9);
  });
});
