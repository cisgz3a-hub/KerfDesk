// ADR-450 through the real compiler and the removal simulator the 3D preview
// uses: with flats finished by the roughing bit, the end mill cuts the floor
// and a plateau top to their exact heights, the finishing raster skips them,
// and the part comes out as the full raster leaves it, flats without scallops.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type Job } from '../job';
import { cncGrblStrategy } from '../output';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type CncLayerSettings,
  type CncTool,
  type ReliefObject,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const SIZE_MM = 40;
const SAMPLES = 80;
const DEPTH_MM = 3;
const CELL_MM = 0.2;
const TIMEOUT_MS = 60_000;
const PLATEAU = { x0: 25, y0: 15, x1: 35, y1: 25, zMm: -1.5 };
const CONE = { x: 13, y: 20, radiusMm: 8 };

function tool(id: string): CncTool {
  const found = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing starter tool ${id}`);
  return found;
}
const EM = tool('em-3175');
const BN = tool('bn-3175');

// The floor, a cone rising to the stock top and a flat-topped plateau.
function model(x: number, y: number): number {
  const cone = -DEPTH_MM * (Math.hypot(x - CONE.x, y - CONE.y) / CONE.radiusMm);
  const onPlateau = x > PLATEAU.x0 && x < PLATEAU.x1 && y > PLATEAU.y0 && y < PLATEAU.y1;
  return Math.max(-DEPTH_MM, cone, onPlateau ? PLATEAU.zMm : -DEPTH_MM);
}

function relief(): ReliefObject {
  const pitch = SIZE_MM / SAMPLES;
  const samples: number[] = [];
  for (let j = 0; j < SAMPLES; j += 1) {
    for (let i = 0; i < SAMPLES; i += 1) {
      const z = model((i + 0.5) * pitch, (j + 0.5) * pitch);
      samples.push(Math.round((0xffff * (z + DEPTH_MM)) / DEPTH_MM));
    }
  }
  return {
    kind: 'relief',
    id: 'relief',
    source: 'plaque.png',
    reliefSource: testReliefHeightfield({
      width: SAMPLES,
      height: SAMPLES,
      physicalWidthMm: SIZE_MM,
      physicalHeightMm: SIZE_MM,
      maxDepthMm: DEPTH_MM,
      samplesU16: samples,
    }),
    targetWidthMm: SIZE_MM,
    reliefDepthMm: DEPTH_MM,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: SIZE_MM, maxY: SIZE_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function compile(settings: Partial<CncLayerSettings>): Job {
  return compileCncJob(
    {
      objects: [relief()],
      layers: [
        {
          ...createLayer({ id: 'L1', color: '#a0522d' }),
          cnc: {
            ...DEFAULT_CNC_LAYER_SETTINGS,
            toolId: EM.id,
            depthPerPassMm: 1.5,
            stepoverPercent: 40,
            ...settings,
          },
        },
      ],
    },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
}

// Both bits, over the relief's own footprint, and the (x, y) in relief mm of
// each removal cell.
function removal(job: Job): { grid: RemovalGrid; at: (index: number) => { x: number; y: number } } {
  const a = toMachineCoords({ x: 0, y: 0 }, DEFAULT_DEVICE_PROFILE);
  const b = toMachineCoords({ x: SIZE_MM, y: SIZE_MM }, DEFAULT_DEVICE_PROFILE);
  const originX = Math.min(a.x, b.x);
  const originY = Math.min(a.y, b.y);
  const result = computeRemovalGrid(
    buildToolpath(job),
    { originX, originY, widthMm: SIZE_MM, heightMm: SIZE_MM, mmPerCell: CELL_MM },
    kernelForTool(EM, CELL_MM),
    {
      toolsByToolKey: new Map([
        [EM.id, EM],
        [BN.id, BN],
      ]),
    },
  );
  if (result.kind === 'error') throw new Error(result.reason);
  const grid = result.grid;
  // Machine Y may run opposite to the relief's: map each cell back.
  const flipY = b.y < a.y;
  return {
    grid,
    at: (index) => {
      const col = index % grid.widthCells;
      const row = Math.floor(index / grid.widthCells);
      const y = (row + 0.5) * CELL_MM;
      return { x: (col + 0.5) * CELL_MM, y: flipY ? SIZE_MM - y : y };
    },
  };
}

// Floor well clear of the cone and plateau, and the plateau top well inside.
function region(x: number, y: number): 'floor' | 'plateau' | null {
  const inset = (margin: number): boolean =>
    x > PLATEAU.x0 - margin &&
    x < PLATEAU.x1 + margin &&
    y > PLATEAU.y0 - margin &&
    y < PLATEAU.y1 + margin;
  if (inset(-1)) return 'plateau';
  const edge = Math.min(x, y, SIZE_MM - x, SIZE_MM - y);
  if (!inset(4) && Math.hypot(x - CONE.x, y - CONE.y) > CONE.radiusMm + 4 && edge > 1)
    return 'floor';
  return null;
}

function heights(grid: RemovalGrid, at: (index: number) => { x: number; y: number }, name: string) {
  const values: number[] = [];
  grid.depth.forEach((depth, index) => {
    const p = at(index);
    if (region(p.x, p.y) === name) values.push(depth);
  });
  return { min: Math.min(...values), max: Math.max(...values) };
}

function finishingLength(job: Job): number {
  let length = 0;
  for (const group of job.groups) {
    if (group.kind !== 'cnc' || group.cutType !== 'relief-finish') continue;
    for (const pass of group.passes) {
      if (pass.kind !== 'path3d') continue;
      pass.points.forEach((p, index) => {
        const next = pass.points[index + 1];
        if (next !== undefined) length += Math.hypot(next.x - p.x, next.y - p.y);
      });
    }
  }
  return length;
}

describe('relief flats finished by the roughing bit (ADR-450)', () => {
  it(
    'cuts the floor and the plateau top to their heights with the end mill',
    () => {
      const on = removal(compile({ reliefFlatFinish: 'roughing-bit' }));
      const off = removal(compile({}));
      // Roughing alone keeps its 0.5 mm allowance on the flats...
      expect(heights(off.grid, off.at, 'floor').min).toBeCloseTo(-2.5, 2);
      // ...and with flat finishing the end mill takes them to height.
      for (const [name, z] of [
        ['floor', -DEPTH_MM],
        ['plateau', PLATEAU.zMm],
      ] as const) {
        const flat = heights(on.grid, on.at, name);
        expect(flat.min).toBeGreaterThanOrEqual(z - 0.005);
        expect(flat.max).toBeLessThanOrEqual(z + 0.005);
      }
    },
    TIMEOUT_MS,
  );

  for (const axis of ['x', 'y'] as const) {
    it(
      `finishes the rest as the full raster does, along ${axis.toUpperCase()}`,
      () => {
        const finishing = { reliefFinishToolId: BN.id, reliefRasterAxis: axis };
        const onJob = compile({ ...finishing, reliefFlatFinish: 'roughing-bit' });
        const offJob = compile(finishing);
        expect(finishingLength(onJob)).toBeLessThan(0.85 * finishingLength(offJob));
        const on = removal(onJob);
        const off = removal(offJob);
        let moreStock = Number.NEGATIVE_INFINITY;
        let gouge = Number.NEGATIVE_INFINITY;
        on.grid.depth.forEach((depth, index) => {
          moreStock = Math.max(moreStock, depth - (off.grid.depth[index] ?? 0));
          const p = on.at(index);
          // The samples cut the cone's apex and the plateau's edges short.
          const sampledShort =
            Math.hypot(p.x - CONE.x, p.y - CONE.y) < 1 ||
            Math.min(Math.abs(p.x - PLATEAU.x0), Math.abs(p.x - PLATEAU.x1)) < 0.75 ||
            Math.min(Math.abs(p.y - PLATEAU.y0), Math.abs(p.y - PLATEAU.y1)) < 0.75;
          if (!sampledShort) gouge = Math.max(gouge, model(p.x, p.y) - depth);
        });
        // Never more stock than the full raster leaves, never below the model.
        expect(moreStock).toBeLessThanOrEqual(0.003);
        expect(gouge).toBeLessThanOrEqual(0.01);
        // The flats come out flat; the ball's rows leave scallops on them.
        const floorOn = heights(on.grid, on.at, 'floor');
        const floorOff = heights(off.grid, off.at, 'floor');
        expect(floorOn.max - floorOn.min).toBeLessThanOrEqual(0.005);
        expect(floorOff.max - floorOff.min).toBeGreaterThan(0.005);
      },
      TIMEOUT_MS,
    );
  }

  it(
    'changes nothing for a ball nose roughing bit',
    () => {
      const settings = { toolId: BN.id, reliefFinishToolId: BN.id };
      const emit = (job: Job): string => cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
      expect(emit(compile({ ...settings, reliefFlatFinish: 'roughing-bit' }))).toBe(
        emit(compile(settings)),
      );
    },
    TIMEOUT_MS,
  );
});
