// ADR-580 through the real compiler: an STL relief is planned against its own
// triangles, so the finishing ball rides a slope exactly where the slope is,
// with no grid error, and Automatic finishes an STL with waterline passes.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, toSceneCoords } from '../devices';
import { scallopRowSpacingMm } from '../relief/relief-finishing';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ReliefObject,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const COLOR = '#a0522d';
const WIDTH_MM = 30;
const HEIGHT_MM = 20;
const DEPTH_MM = 6;
// The ramp rises DEPTH_MM over HEIGHT_MM along the relief's Y.
const SLOPE = DEPTH_MM / HEIGHT_MM;

function tool(id: string) {
  const found = DEFAULT_CNC_MACHINE_CONFIG.tools.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`missing starter tool ${id}`);
  return found;
}

// An inclined plane: depth -DEPTH_MM at relief y = 0, the stock top at
// y = HEIGHT_MM (stored in the canvas frame, as an import stores it).
function rampRelief(): ReliefObject {
  const low = (x: number) => [x, 0, 0];
  const high = (x: number) => [x, HEIGHT_MM, DEPTH_MM];
  const positions = [
    ...low(0),
    ...low(WIDTH_MM),
    ...high(WIDTH_MM),
    ...low(0),
    ...high(WIDTH_MM),
    ...high(0),
  ];
  return {
    kind: 'relief',
    id: 'ramp',
    source: 'ramp.stl',
    reliefSource: { kind: 'legacy-mesh', meshPositions: positions, emptyCells: 'floor' },
    targetWidthMm: WIDTH_MM,
    reliefDepthMm: DEPTH_MM,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: HEIGHT_MM },
    transform: IDENTITY_TRANSFORM,
  };
}

function depthMapRelief(): ReliefObject {
  return {
    kind: 'relief',
    id: 'map',
    source: 'surface.png',
    reliefSource: testReliefHeightfield({
      width: 2,
      height: 2,
      physicalWidthMm: 12,
      physicalHeightMm: 12,
      maxDepthMm: 5,
      samplesU8: [0, 255, 128, 255],
    }),
    targetWidthMm: 12,
    reliefDepthMm: 5,
    color: COLOR,
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
    transform: IDENTITY_TRANSFORM,
  };
}

function compile(relief: ReliefObject, cnc: Partial<CncLayerSettings>) {
  const scene: Scene = {
    objects: [relief],
    layers: [
      {
        ...createLayer({ id: 'L1', color: COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'engrave',
          toolId: 'em-6350',
          depthPerPassMm: 3,
          reliefFinishToolId: 'bn-3175',
          ...cnc,
        },
      },
    ],
  };
  return compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
}

function finishingPlan(job: ReturnType<typeof compile>) {
  const plan = job.cncCompilation?.reliefPlans?.find(
    (candidate) => candidate.stage === 'finishing',
  );
  if (plan === undefined) throw new Error('no finishing plan');
  return plan;
}

describe('an STL relief is finished against its own triangles (ADR-580)', () => {
  it('the ball rides a slope at the exact ball-on-plane height', () => {
    const job = compile(rampRelief(), { reliefFinishStrategy: 'raster' });
    const group = job.groups.find((g) => g.kind === 'cnc' && g.cutType === 'relief-finish');
    if (group?.kind !== 'cnc') throw new Error('no relief-finish group');
    const r = tool('bn-3175').diameterMm / 2;
    // A ball on a plane of slope g touches it r (sqrt(1 + g^2) - 1) above the
    // plane under its axis. Highest-point cells lifted this by about half a
    // cell times the slope (0.04 mm here).
    const lift = r * (Math.sqrt(1 + SLOPE * SLOPE) - 1);
    let checked = 0;
    let worst = 0;
    // The path keeps only the vertices a straight move cannot replace, so it
    // is read along every move, not only at its vertices.
    for (const pass of group.passes) {
      if (pass.kind !== 'path3d') continue;
      pass.points.forEach((from, index) => {
        const to = pass.points[index + 1];
        if (to === undefined) return;
        for (let s = 0; s <= 8; s += 1) {
          const t = s / 8;
          const point = {
            x: from.x + t * (to.x - from.x),
            y: from.y + t * (to.y - from.y),
          };
          const local = toSceneCoords(point, DEFAULT_DEVICE_PROFILE);
          // Away from the relief's edges, where only the plane can touch.
          const margin = r + 0.05;
          if (local.x < margin || local.x > WIDTH_MM - margin) continue;
          if (local.y < margin || local.y > HEIGHT_MM - margin) continue;
          const z = from.z + t * (to.z - from.z);
          const plane = -DEPTH_MM + SLOPE * local.y;
          worst = Math.max(worst, Math.abs(z - (plane + lift)));
          checked += 1;
        }
      });
    }
    expect(checked).toBeGreaterThan(100);
    expect(worst).toBeLessThan(1e-5);
  });

  it('Automatic adds waterline passes to an STL relief and keeps the raster for a height map', () => {
    const ball = tool('bn-3175');
    const scallopMm = 0.025;
    const rows = scallopRowSpacingMm(ball, scallopMm);
    const stl = finishingPlan(compile(rampRelief(), { reliefScallopMm: scallopMm }));
    expect(stl.rowSpacingMm).toBeCloseTo(rows * Math.cos(Math.PI / 4), 12);
    const map = finishingPlan(compile(depthMapRelief(), { reliefScallopMm: scallopMm }));
    expect(map.rowSpacingMm).toBeCloseTo(rows, 12);
    const pinned = finishingPlan(
      compile(rampRelief(), { reliefScallopMm: scallopMm, reliefFinishStrategy: 'raster' }),
    );
    expect(pinned.rowSpacingMm).toBeCloseTo(rows, 12);
  });
});
