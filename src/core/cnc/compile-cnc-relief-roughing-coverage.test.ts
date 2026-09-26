// ADR-289 Amendment 1 through the real compiler and the removal simulator the
// 3D preview uses: relief roughing rings end where they start, and above 50%
// stepover a level's centre is cleared, for an end mill and a tapered ball
// nose alike.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import { buildToolpath, type CncContourPass, type Job } from '../job';
import { computeRemovalGrid, kernelForTool, type RemovalGrid } from '../sim';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
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
function compile(relief: ReliefObject, cutter: CncTool, stepoverPercent: number): Job {
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

function roughingRings(job: Job): ReadonlyArray<CncContourPass> {
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
      const rings = roughingRings(compile(relief, cutter, stepoverPercent));
      expect(rings.length).toBeGreaterThan(0);
      for (const ring of rings) {
        // Before ADR-289 Amendment 1 each ring stopped at the corner before its
        // start, half a side short on a square ring.
        expect(ring.polyline[ring.polyline.length - 1]).toEqual(ring.polyline[0]);
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
  });

  it('leave no stock at the ring seams with a tapered ball nose', () => {
    const relief = flatRelief(20);
    // 11% spaces the rings at most 0.69 mm apart (11% of the widest diameter),
    // close enough that no rib stands between them at a 1.5 mm level.
    const job = compile(relief, TBN, 11);
    expect(cellsLeftStanding(removal(job, TBN, machineBox(relief)), BALL_SLACK_MM)).toBe(0);
  });
});

describe('relief roughing core cleanup', () => {
  it('clears the centre an end mill leaves above 50% stepover', () => {
    // At 85% a 6.35 mm end mill's second ring stops 4.6 mm from the centre of
    // a 20 mm relief and sweeps 3.175 mm, which left a 2.9 mm core standing.
    const relief = flatRelief(20);
    const cutter = tool('em-6350');
    const job = compile(relief, cutter, 85);
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
  });

  it('clears the centre a tapered ball nose leaves above 50% stepover', () => {
    const relief = flatRelief(20);
    const grid = removal(compile(relief, TBN, 85), TBN, machineBox(relief));
    // The centre stood at the stock top; its cleanup ring now puts the tip on
    // the floor there.
    expect(depthAtCentre(grid)).toBeLessThanOrEqual(-DEPTH_MM + BALL_SLACK_MM);
  });

  it('adds no pass where the rings already reach the centre', () => {
    // A 13 mm relief at 85%: the second ring passes 1.1 mm from the centre,
    // well inside the 3.175 mm the 6.35 mm end mill sweeps.
    const relief = flatRelief(13);
    const cutter = tool('em-6350');
    const job = compile(relief, cutter, 85);
    // Two rings on each of the two levels, and nothing else.
    expect(roughingRings(job)).toHaveLength(4);
    expect(cellsLeftStanding(removal(job, cutter, machineBox(relief)), FLAT_SLACK_MM)).toBe(0);
  });
});
