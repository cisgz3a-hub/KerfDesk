// ADR-289 Amendment 1 through the real compiler and the removal simulator the
// 3D preview uses: relief roughing rings end where they start, and above 50%
// stepover a level's centre is cleared, for an end mill and a tapered ball
// nose alike.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type CncContourPass, type Job } from '../job';
import { pointInPolygon } from '../geometry/point-in-polygon';
import { signedAreaMm2 } from '../geometry/polyline-orientation';
import { chainLoops, roughingLoops } from '../relief/relief-roughing-chain.test-support';
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
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

// Amana 46282 as ADR-368 models it: 6.25 mm across the top of the flutes, a
// 1/16" ball tip, 5.4 degrees per side.
const TBN: CncTool = {
  id: 'tbn-46282',
  name: 'Amana 46282 tapered ball nose',
  kind: 'tapered-ball-nose',
  diameterMm: 6.25,
  tipAngleDeg: 10.8,
  tipDiameterMm: 1.5875,
};
const DEPTH_MM = 3;
const CELL_MM = 0.1;
// A flat end mill cuts every reached cell to the floor exactly.
const FLAT_SLACK_MM = 0.01;
// The tapered ball nose's tip rises 0.08 mm midway between rings 0.69 mm
// apart, the tightest spacing below; a missed seam or core stands 1.5 mm or
// more above the floor.
const BALL_SLACK_MM = 0.15;

function tool(id: string): CncTool {
  const found = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing starter tool ${id}`);
  return found;
}

// One sample at the darkest code: a flat floor at the full depth.
function flatRelief(sizeMm: number): ReliefObject {
  return {
    kind: 'relief',
    id: 'relief',
    source: 'floor.png',
    reliefSource: testReliefHeightfield({
      width: 1,
      height: 1,
      physicalWidthMm: sizeMm,
      physicalHeightMm: sizeMm,
      maxDepthMm: DEPTH_MM,
      samplesU8: [0],
    }),
    targetWidthMm: sizeMm,
    reliefDepthMm: DEPTH_MM,
    color: '#a0522d',
    bounds: { minX: 0, minY: 0, maxX: sizeMm, maxY: sizeMm },
    transform: IDENTITY_TRANSFORM,
  };
}

// No finishing allowance, so the roughing floor is the relief floor.
function compile(
  relief: ReliefObject,
  cutter: CncTool,
  stepoverPercent: number,
  settings: Partial<CncLayerSettings> = {},
): Job {
  const scene: Scene = {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: 'L1', color: '#a0522d' }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          toolId: cutter.id,
          depthPerPassMm: 1.5,
          stepoverPercent,
          finishAllowanceMm: 0,
          ...settings,
        },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, {
    ...DEFAULT_CNC_MACHINE_CONFIG,
    tools: [...DEFAULT_CNC_MACHINE_CONFIG.tools, TBN],
    toolId: cutter.id,
  });
}

function roughingPasses(job: Job): ReadonlyArray<CncContourPass> {
  return job.groups.flatMap((group) =>
    group.kind === 'cnc' && group.cutType === 'relief-rough'
      ? group.passes.filter((pass): pass is CncContourPass => pass.kind === 'contour')
      : [],
  );
}

type Box = {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
};

function machineBox(relief: ReliefObject): Box {
  const corners = [
    toMachineCoords({ x: relief.bounds.minX, y: relief.bounds.minY }, DEFAULT_DEVICE_PROFILE),
    toMachineCoords({ x: relief.bounds.maxX, y: relief.bounds.maxY }, DEFAULT_DEVICE_PROFILE),
  ];
  const xs = corners.map((corner) => corner.x);
  const ys = corners.map((corner) => corner.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

// The removal simulator over the relief's own footprint.
function removal(job: Job, cutter: CncTool, box: Box): RemovalGrid {
  const result = computeRemovalGrid(
    buildToolpath(job),
    {
      originX: box.minX,
      originY: box.minY,
      widthMm: box.maxX - box.minX,
      heightMm: box.maxY - box.minY,
      mmPerCell: CELL_MM,
    },
    kernelForTool(cutter, CELL_MM),
  );
  if (result.kind === 'error') throw new Error(result.reason);
  return result.grid;
}

// Cells whose floor stands more than `slackMm` above the relief floor.
function cellsLeftStanding(grid: RemovalGrid, slackMm: number): number {
  let count = 0;
  for (const depth of grid.depth) if (depth > -DEPTH_MM + slackMm) count += 1;
  return count;
}

function depthAtCentre(grid: RemovalGrid): number {
  const col = Math.floor(grid.widthCells / 2);
  const row = Math.floor(grid.heightCells / 2);
  return grid.depth[row * grid.widthCells + col] ?? 0;
}

describe('relief roughing rings', () => {
  it('end every ring where it starts, for any bit', () => {
    const relief = flatRelief(20);
    for (const [cutter, stepoverPercent] of [
      [tool('em-3175'), 40],
      [TBN, 40],
      [tool('em-6350'), 85],
    ] as const) {
      const passes = roughingPasses(compile(relief, cutter, stepoverPercent));
      expect(passes.length).toBeGreaterThan(0);
      for (const pass of passes) {
        // Before ADR-289 Amendment 1 each ring stopped at the corner before its
        // start, half a side short on a square ring. A pass now cuts several
        // rings joined at depth (ADR-424); every one of them closes.
        const loops = chainLoops(pass.polyline);
        expect(loops.length).toBeGreaterThan(0);
        expect(loops.flat()).toHaveLength(pass.polyline.length);
      }
    }
  });

  it('leave no stock at the ring seams with an end mill', () => {
    const relief = flatRelief(20);
    const cutter = tool('em-3175');
    const job = compile(relief, cutter, 40);
    // The half-sides the rings dropped left about 1,100 cells uncut to the
    // stock top on the half of the relief holding the seams.
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
  }, 60_000);

  it('leave no stock at the ring seams with a tapered ball nose', () => {
    const relief = flatRelief(20);
    // 11% spaces the rings at most 0.69 mm apart (11% of the widest diameter),
    // close enough that no rib stands between them at a 1.5 mm level.
    const job = compile(relief, TBN, 11);
    expect(cellsLeftStanding(removal(job, TBN, machineBox(relief)), BALL_SLACK_MM)).toBe(0);
  }, 60_000);
});

describe('relief roughing core cleanup', () => {
  it('clears the centre an end mill leaves above 50% stepover', () => {
    // At 85% a 6.35 mm end mill's second ring stops 4.6 mm from the centre of
    // a 20 mm relief and sweeps 3.175 mm, which left a 2.9 mm core standing.
    const relief = flatRelief(20);
    const cutter = tool('em-6350');
    const job = compile(relief, cutter, 85);
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
  }, 60_000);

  it('clears the centre a tapered ball nose leaves above 50% stepover', () => {
    const relief = flatRelief(20);
    const grid = removal(compile(relief, TBN, 85), TBN, machineBox(relief));
    // The centre stood at the stock top; its cleanup ring now puts the tip on
    // the floor there.
    expect(depthAtCentre(grid)).toBeLessThanOrEqual(-DEPTH_MM + BALL_SLACK_MM);
  }, 60_000);

  it('adds no pass where the rings already reach the centre', () => {
    // A 13 mm relief at 85%: the second ring passes 1.1 mm from the centre,
    // well inside the 3.175 mm the 6.35 mm end mill sweeps.
    const relief = flatRelief(13);
    const cutter = tool('em-6350');
    const job = compile(relief, cutter, 85);
    // Two rings on each of the two levels, and nothing else.
    expect(roughingLoops(roughingPasses(job))).toHaveLength(4);
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
  }, 60_000);
});

describe('relief roughing motion (ADR-424)', () => {
  it('joins each level of a flat relief into one pass at depth', () => {
    const relief = flatRelief(20);
    const job = compile(relief, tool('em-3175'), 40);
    const passes = roughingPasses(job);

    // Two 1.5 mm levels, each cut without lifting between its rings.
    expect(passes).toHaveLength(2);
    expect(roughingLoops(passes).length).toBeGreaterThan(passes.length * 4);
  });

  it('clears the floor with ramped entries as it does with plunges', () => {
    const relief = flatRelief(20);
    const cutter = tool('em-3175');
    const job = compile(relief, cutter, 40, { rampEntryDeg: 3 });
    const group = job.groups.find((g) => g.kind === 'cnc' && g.cutType === 'relief-rough');
    if (group?.kind !== 'cnc') throw new Error('roughing group missing');

    expect(group.passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    for (const pass of group.passes) {
      if (pass.kind !== 'path3d') continue;
      // Each level ramps down from the one above rather than from safe height.
      expect(pass.points[0]?.z).toBeGreaterThan(pass.points[pass.points.length - 1]?.z ?? 0);
      expect(pass.points[0]?.z).toBeLessThanOrEqual(0);
    }
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
    // The G-code records the entry, with no advisory about ramps below the
    // stock top: each starts where the level above has cut.
    const gcode = cncGrblStrategy.emit({ groups: [group] }, DEFAULT_DEVICE_PROFILE);
    expect(gcode).toContain('; cnc entry: contour-ramp; max-angle-deg: 3');
    expect(gcode).not.toContain('entry-advisory');
  });

  it('climbs round an island as it does round the outside', () => {
    const relief = bossRelief();
    const box = machineBox(relief);
    const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const cutter = tool('em-3175');
    // Rings grow out from the island's edge, one tool radius off the boss, and
    // in from the relief's edge; they meet midway between the two.
    const meetMm = (BOSS_HALF_MM + cutter.diameterMm / 2 + BOSS_RELIEF_MM / 2) / 2;
    const chebyshev = (p: { x: number; y: number }) =>
      Math.max(Math.abs(p.x - centre.x), Math.abs(p.y - centre.y));
    const windings = (cutDirection: 'climb' | 'conventional') => {
      const loops = roughingLoops(roughingPasses(compile(relief, cutter, 40, { cutDirection })));
      // The corner pieces left between the two families do not circle the boss.
      const island = loops.filter(
        (loop) =>
          pointInPolygon(centre, loop.points) && loop.points.every((p) => chebyshev(p) < meetMm),
      );
      const outer = loops.filter((loop) => !island.includes(loop));
      return {
        island: island.map((loop) => Math.sign(signedAreaMm2(loop.points.slice(0, -1)))),
        outer: outer.map((loop) => Math.sign(signedAreaMm2(loop.points.slice(0, -1)))),
      };
    };
    const climb = windings('climb');
    const conventional = windings('conventional');

    expect(climb.island.length).toBeGreaterThan(0);
    expect(climb.outer.length).toBeGreaterThan(0);
    // Clockwise round the island keeps its stock right of travel, as the
    // waterline passes circle a boss; the outer rings run anticlockwise.
    expect(new Set(climb.island)).toEqual(new Set([-1]));
    expect(new Set(climb.outer)).toEqual(new Set([1]));
    expect(new Set(conventional.island)).toEqual(new Set([1]));
    expect(new Set(conventional.outer)).toEqual(new Set([-1]));
  });
});

describe('relief roughing fine steps (ADR-422 Amendment 1)', () => {
  // The pyramid's faces fall DEPTH_MM over half its width: a 0.2 slope. A flat
  // end mill's tip stands radius x slope above such a face wherever it may go.
  const slope = DEPTH_MM / (PYRAMID_MM / 2);
  const cutter = tool('em-3175');
  const tipRiseMm = (cutter.diameterMm / 2) * slope;

  function leftover(settings: Partial<CncLayerSettings>): { max: number; min: number } {
    const relief = pyramidRelief();
    const box = machineBox(relief);
    const grid = removal(compile(relief, cutter, 40, settings), cutter, box);
    const middle = PYRAMID_MM / 2;
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    for (let row = 0; row < grid.heightCells; row += 1) {
      for (let col = 0; col < grid.widthCells; col += 1) {
        const off = Math.max(
          Math.abs((col + 0.5) * CELL_MM - middle),
          Math.abs((row + 0.5) * CELL_MM - middle),
        );
        const left = (grid.depth[row * grid.widthCells + col] ?? 0) + slope * off;
        max = Math.max(max, left);
        min = Math.min(min, left);
      }
    }
    return { max, min };
  }

  it('cuts the terraces on a slope down to one fine step', () => {
    const coarse = leftover({});
    const fine = leftover({ reliefFineStepMm: 0.3 });

    // Without fine steps a face keeps the whole 1.5 mm slice as a terrace.
    expect(coarse.max).toBeGreaterThan(1.5);
    expect(fine.max).toBeLessThanOrEqual(0.3 + tipRiseMm + 0.1);
    expect(fine.min).toBeGreaterThanOrEqual(-FLAT_SLACK_MM);
  });
});

const PYRAMID_MM = 30;
const PYRAMID_SAMPLES = 60;

// A square pyramid whose apex touches the stock top and whose base corners
// reach the full depth.
function pyramidRelief(): ReliefObject {
  const pitch = PYRAMID_MM / PYRAMID_SAMPLES;
  const middle = PYRAMID_MM / 2;
  const samples: number[] = [];
  for (let j = 0; j < PYRAMID_SAMPLES; j += 1) {
    for (let i = 0; i < PYRAMID_SAMPLES; i += 1) {
      const off = Math.max(
        Math.abs((i + 0.5) * pitch - middle),
        Math.abs((j + 0.5) * pitch - middle),
      );
      samples.push(Math.round(0xffff * (1 - off / middle)));
    }
  }
  return {
    ...flatRelief(PYRAMID_MM),
    reliefSource: testReliefHeightfield({
      width: PYRAMID_SAMPLES,
      height: PYRAMID_SAMPLES,
      physicalWidthMm: PYRAMID_MM,
      physicalHeightMm: PYRAMID_MM,
      maxDepthMm: DEPTH_MM,
      samplesU16: samples,
    }),
  };
}

const BOSS_RELIEF_MM = 30;
const BOSS_HALF_MM = 4;

// A 30 mm flat relief with an 8 mm boss standing to the stock top in its
// middle: every level's region has an island.
function bossRelief(): ReliefObject {
  const size = BOSS_RELIEF_MM;
  const middle = size / 2;
  const samples: number[] = [];
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const off = Math.max(Math.abs(i + 0.5 - middle), Math.abs(j + 0.5 - middle));
      samples.push(off < BOSS_HALF_MM ? 255 : 0);
    }
  }
  return {
    ...flatRelief(size),
    reliefSource: testReliefHeightfield({
      width: size,
      height: size,
      physicalWidthMm: size,
      physicalHeightMm: size,
      maxDepthMm: DEPTH_MM,
      samplesU8: samples,
    }),
  };
}
