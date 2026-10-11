// ADR-412 Amendment 1 and ADR-580 through the real compiler: a raised rib
// narrower than a planning cell, standing between two cell centres, is still
// there for the planner. Centre sampling alone cut straight through such a rib
// and ran the finishing ball over it at floor height; the cutter now meets the
// STL's own triangles (ADR-580), as the highest-point cells of Amendment 1 did
// before it.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, toMachineCoords } from '../devices';
import type { CncPass } from '../job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type CncTool,
  type Scene,
} from '../scene';
import type { MeshReliefObject } from '../scene/relief';
import { FINISHING_CONTACT_TOLERANCE_MM } from '../relief/relief-finishing-contact';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#a0522d';
const WIDTH_MM = 24;
const HEIGHT_MM = 14;
const DEPTH_MM = 6;
const RIB_TOP_Z = -2;
const ALLOWANCE_MM = 0.5;
// Where the rib stands on the relief, in its own millimetres.
type Rect = { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
type Point3 = { readonly x: number; readonly y: number; readonly z: number };

function tool(id: string): CncTool {
  const found = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing starter tool ${id}`);
  return found;
}

// A box's flat top and its vertical walls down to the floor (z = 0), the way
// an STL models it; the walls have no plan area.
function pushBox(p: number[], rect: Rect, top: number): void {
  const { x0, y0, x1, y1 } = rect;
  p.push(x0, y0, top, x1, y0, top, x1, y1, top, x0, y0, top, x1, y1, top, x0, y1, top);
  const corners = [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ] as const;
  for (let i = 0; i < 4; i += 1) {
    const [ax, ay] = corners[i]!;
    const [bx, by] = corners[(i + 1) % 4]!;
    p.push(ax, ay, 0, bx, by, 0, bx, by, top, ax, ay, 0, bx, by, top, ax, ay, top);
  }
}

// The floor 6 mm down, one rib standing 4 mm on it, and a pad in the far
// corner at the stock top (the mesh's highest point is the stock top).
function ribRelief(rib: Rect): MeshReliefObject {
  const p: number[] = [0, 0, 0, WIDTH_MM, 0, 0, WIDTH_MM, HEIGHT_MM, 0];
  p.push(0, 0, 0, WIDTH_MM, HEIGHT_MM, 0, 0, HEIGHT_MM, 0);
  pushBox(p, rib, DEPTH_MM + RIB_TOP_Z);
  pushBox(p, { x0: 0, y0: 0, x1: 3, y1: 3 }, DEPTH_MM);
  return {
    kind: 'relief',
    id: 'rib',
    source: 'rib.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: p, emptyCells: 'floor' },
    targetWidthMm: WIDTH_MM,
    reliefDepthMm: DEPTH_MM,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: HEIGHT_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function compile(relief: MeshReliefObject, cnc: Partial<CncLayerSettings>) {
  const scene: Scene = {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          depthPerPassMm: 2,
          stepoverPercent: 40,
          finishAllowanceMm: ALLOWANCE_MM,
          // The raster's own cell grid is the premise; ADR-580's Automatic
          // would add waterline passes and pack the rows closer for an STL.
          reliefFinishStrategy: 'raster',
          ...cnc,
        },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

// The premise of each case: no cell centre of that stage's grid lies on the rib.
function centresOnRib(job: ReturnType<typeof compile>, stage: string, rib: Rect): number {
  const plan = job.cncCompilation?.reliefPlans?.find((candidate) => candidate.stage === stage);
  if (plan === undefined) throw new Error(`no ${stage} plan`);
  let count = 0;
  for (let k = 0; (k + 0.5) * plan.cellSizeMm < WIDTH_MM; k += 1) {
    const centre = (k + 0.5) * plan.cellSizeMm;
    if (centre >= rib.x0 && centre <= rib.x1) count += 1;
  }
  return count;
}

function finishingCellMm(job: ReturnType<typeof compile>): number {
  const plan = job.cncCompilation?.reliefPlans?.find(
    (candidate) => candidate.stage === 'finishing',
  );
  if (plan === undefined) throw new Error('no finishing plan');
  return plan.cellSizeMm;
}

function groupPasses(job: ReturnType<typeof compile>, cutType: string): ReadonlyArray<CncPass> {
  const group = job.groups.find((g) => g.kind === 'cnc' && g.cutType === cutType);
  if (group?.kind !== 'cnc') throw new Error(`no ${cutType} group`);
  return group.passes;
}

// Every tool position along the passes, at most `stepMm` apart.
function toolPositions(passes: ReadonlyArray<CncPass>, stepMm: number): Point3[] {
  const out: Point3[] = [];
  for (const pass of passes) {
    const points: ReadonlyArray<Point3> =
      pass.kind === 'contour'
        ? pass.polyline.map((point) => ({ ...point, z: pass.zMm }))
        : pass.kind === 'path3d'
          ? pass.points
          : [];
    points.forEach((a, index) => {
      const b = points[index + 1] ?? a;
      const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / stepMm));
      for (let s = 0; s < steps; s += 1) {
        const t = s / steps;
        out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y), z: a.z + t * (b.z - a.z) });
      }
    });
  }
  return out;
}

// The rib as a machine-space box from the floor up to its top.
function machineRect(rib: Rect): Rect {
  const a = toMachineCoords({ x: rib.x0, y: rib.y0 }, DEFAULT_DEVICE_PROFILE);
  const b = toMachineCoords({ x: rib.x1, y: rib.y1 }, DEFAULT_DEVICE_PROFILE);
  return {
    x0: Math.min(a.x, b.x),
    y0: Math.min(a.y, b.y),
    x1: Math.max(a.x, b.x),
    y1: Math.max(a.y, b.y),
  };
}

function planGap(point: Point3, box: Rect): { readonly dx: number; readonly dy: number } {
  return {
    dx: Math.max(box.x0 - point.x, 0, point.x - box.x1),
    dy: Math.max(box.y0 - point.y, 0, point.y - box.y1),
  };
}

// Closest a flat end mill (tip at z) comes to the rib; 0 means it cuts into it.
function flatClearanceMm(point: Point3, box: Rect, radiusMm: number): number {
  const { dx, dy } = planGap(point, box);
  return Math.hypot(Math.max(0, Math.hypot(dx, dy) - radiusMm), Math.max(0, point.z - RIB_TOP_Z));
}

// How far a ball nose (tip at z) stays outside the rib; negative is a cut.
function ballClearanceMm(point: Point3, box: Rect, radiusMm: number): number {
  const { dx, dy } = planGap(point, box);
  const dz = Math.max(0, point.z + radiusMm - RIB_TOP_Z);
  return Math.hypot(dx, dy, dz) - radiusMm;
}

// The least clearance over every tool position along the passes.
function worst(passes: ReadonlyArray<CncPass>, clearance: (point: Point3) => number): number {
  return toolPositions(passes, 0.02).reduce(
    (low, point) => Math.min(low, clearance(point)),
    Number.POSITIVE_INFINITY,
  );
}

describe('relief CAM reads an STL rib narrower than a cell', () => {
  it('roughing keeps the allowance around a rib between two cell centres', () => {
    // 1/4" end mill: roughing cells are 6.35 / 8 = 0.79375 mm, centred at
    // 9.922 and 10.716 mm either side of this 0.4 mm rib.
    const rib = { x0: 10.1, y0: 3, x1: 10.5, y1: 11 };
    const cutter = tool('em-6350');
    const job = compile(ribRelief(rib), { toolId: cutter.id });
    expect(centresOnRib(job, 'roughing', rib)).toBe(0);
    const passes = groupPasses(job, 'relief-rough');
    const box = machineRect(rib);

    // Centre sampling never saw the rib and cut into it (clearance 0); the
    // rib now keeps the whole 0.5 mm allowance.
    const clearance = worst(passes, (p) => flatClearanceMm(p, box, cutter.diameterMm / 2));
    expect(clearance).toBeGreaterThanOrEqual(ALLOWANCE_MM - 1e-6);
  });

  it('finishing rides over a rib narrower than a finishing cell', () => {
    // 1/8" ball at the default scallop: finishing cells are 0.2806 mm,
    // centred at 9.962 and 10.243 mm either side of this 0.2 mm rib.
    const rib = { x0: 10, y0: 3, x1: 10.2, y1: 11 };
    const roughing = tool('em-6350');
    const ball = tool('bn-3175');
    const job = compile(ribRelief(rib), { toolId: roughing.id, reliefFinishToolId: ball.id });
    expect(centresOnRib(job, 'finishing', rib)).toBe(0);
    const box = machineRect(rib);

    // Centre sampling ran the ball through the rib at floor height (-1.59 mm);
    // the ball now rides over it on the exact contact (-0.0022 mm measured).
    // The finishing check holds its tolerance at every quarter-cell check
    // (relief-finishing-contact.ts); between two checks the straight move can
    // sag under the ball centre's circular path over the rib's edge by that
    // chord's sagitta.
    const clearance = worst(groupPasses(job, 'relief-finish'), (p) =>
      ballClearanceMm(p, box, ball.diameterMm / 2),
    );
    const chordMm = finishingCellMm(job) / 4;
    const sagittaMm = (chordMm * chordMm) / (8 * (ball.diameterMm / 2));
    expect(clearance).toBeGreaterThanOrEqual(-(FINISHING_CONTACT_TOLERANCE_MM + sagittaMm));
  });
});
