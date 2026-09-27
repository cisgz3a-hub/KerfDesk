// ADR-423 compile integration: a relief layer's finish strategy and raster
// direction reach the relief-finish group, and the waterline keeps the wall
// on the side the cut direction asks for on the physical bed, whatever the
// placement or machine origin mirrors.

import { describe, expect, it } from 'vitest';
import { testReliefHeightfield } from '../../__fixtures__/relief-heightfield';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../devices';
import type { CncPass } from '../job';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ReliefObject,
  type Scene,
  type Transform,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

const RELIEF_COLOR = '#a0522d';
const CELLS = 12;

// A 4 mm square boss 5 mm proud of the floor, in the middle of 12 mm.
function bossRelief(transform: Transform = IDENTITY_TRANSFORM): ReliefObject {
  const samples = Array.from({ length: CELLS * CELLS }, (_, index) => {
    const i = index % CELLS;
    const j = Math.floor(index / CELLS);
    return i >= 4 && i < 8 && j >= 4 && j < 8 ? 255 : 0;
  });
  return {
    kind: 'relief',
    id: 'B1',
    source: 'boss.png',
    reliefSource: testReliefHeightfield({
      width: CELLS,
      height: CELLS,
      physicalWidthMm: 12,
      physicalHeightMm: 12,
      maxDepthMm: 5,
      samplesU8: samples,
      provenance: { sourceName: 'boss.png' },
    }),
    targetWidthMm: 12,
    reliefDepthMm: 5,
    color: RELIEF_COLOR,
    bounds: { minX: 0, minY: 0, maxX: 12, maxY: 12 },
    transform,
  };
}

// A flat relief 5 mm deep inside a round mask outline: the only steep wall is
// the stock the mask leaves standing round it (ADR-484).
function maskedDiscRelief(): ReliefObject {
  const inclusionMask = Array.from({ length: CELLS * CELLS }, (_, index) => {
    const x = (index % CELLS) + 0.5;
    const y = Math.floor(index / CELLS) + 0.5;
    return Math.hypot(x - 6, y - 6) < 4.5 ? 255 : 0;
  });
  return {
    ...bossRelief(),
    id: 'D1',
    source: 'disc.png',
    reliefSource: testReliefHeightfield({
      width: CELLS,
      height: CELLS,
      physicalWidthMm: 12,
      physicalHeightMm: 12,
      maxDepthMm: 5,
      samplesU8: new Array<number>(CELLS * CELLS).fill(0),
      inclusionMask,
      provenance: { sourceName: 'disc.png' },
    }),
  };
}

// Loops at one level: 20 or more consecutive points at one height whose extent
// reaches 4 mm both ways. The raster's rows climb to the mask at both ends,
// so none of its level stretches spans both ways.
function levelLoops(passes: ReadonlyArray<CncPass>): number {
  let loops = 0;
  for (const pass of passes) {
    if (pass.kind !== 'path3d') continue;
    let stretch: Array<{ x: number; y: number; z: number }> = [];
    for (const point of [...pass.points, null]) {
      if (point !== null && (stretch.length === 0 || stretch[0]?.z === point.z)) {
        stretch.push(point);
        continue;
      }
      if (isLoop(stretch)) loops += 1;
      stretch = point === null ? [] : [point];
    }
  }
  return loops;
}

function isLoop(points: ReadonlyArray<{ x: number; y: number }>): boolean {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return (
    points.length >= 20 &&
    Math.max(...xs) - Math.min(...xs) >= 4 &&
    Math.max(...ys) - Math.min(...ys) >= 4
  );
}

function finishPasses(
  cnc: Partial<CncLayerSettings>,
  object: ReliefObject = bossRelief(),
  device: DeviceProfile = DEFAULT_DEVICE_PROFILE,
): ReadonlyArray<CncPass> {
  const scene: Scene = {
    objects: [object],
    layers: [
      {
        ...createLayer({ id: RELIEF_COLOR, color: RELIEF_COLOR }),
        cnc: {
          ...DEFAULT_CNC_LAYER_SETTINGS,
          cutType: 'engrave',
          reliefFinishToolId: 'bn-3175',
          ...cnc,
        },
      },
    ],
  };
  const job = compileCncJob(scene, device, DEFAULT_CNC_MACHINE_CONFIG);
  const finish = job.groups.find(
    (group) => group.kind === 'cnc' && group.cutType === 'relief-finish',
  );
  if (finish?.kind !== 'cnc') throw new Error('finish group missing');
  return finish.passes;
}

// Winding of the waterline passes (after the one raster pass) about their
// centre in machine numbers: negative is clockwise.
function waterlineTurn(passes: ReadonlyArray<CncPass>): number {
  const points = passes.slice(1).flatMap((pass) => (pass.kind === 'path3d' ? pass.points : []));
  const cx = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const cy = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  let sum = 0;
  for (let k = 1; k < points.length; k += 1) {
    const a = points[k - 1];
    const b = points[k];
    if (a === undefined || b === undefined) continue;
    sum += (a.x - cx) * (b.y - cy) - (b.x - cx) * (a.y - cy);
  }
  return sum;
}

describe('relief finish strategy compile (ADR-423)', { timeout: 60_000 }, () => {
  it('finishes the steep walls with waterline passes after the raster', () => {
    const raster = finishPasses({});
    const passes = finishPasses({ reliefFinishStrategy: 'raster-waterline' });

    expect(raster).toHaveLength(1);
    expect(passes.length).toBeGreaterThan(1);
    // The raster rows are closer together under the waterline strategy.
    const rasterPoints = raster[0]?.kind === 'path3d' ? raster[0].points.length : 0;
    const narrowedPoints = passes[0]?.kind === 'path3d' ? passes[0].points.length : 0;
    expect(narrowedPoints).toBeGreaterThan(rasterPoints);
  });

  it('runs the raster along Y when asked', () => {
    const [row] = finishPasses({ reliefRasterAxis: 'y' });
    if (row?.kind !== 'path3d') throw new Error('raster missing');
    const [first, second] = row.points;

    // The first row starts along Y: X holds while Y moves.
    expect(second?.x).toBe(first?.x);
    expect(second?.y).not.toBe(first?.y);
  });

  it('circles the boss clockwise for climb and anticlockwise for conventional', () => {
    const climb = finishPasses({ reliefFinishStrategy: 'raster-waterline' });
    const conventional = finishPasses({
      reliefFinishStrategy: 'raster-waterline',
      cutDirection: 'conventional',
    });

    // Clockwise round a raised boss keeps it right of travel: climb.
    expect(waterlineTurn(climb)).toBeLessThan(0);
    expect(waterlineTurn(conventional)).toBeGreaterThan(0);
  });

  it('circles the stock a mask outline leaves standing (ADR-484)', () => {
    const raster = finishPasses({}, maskedDiscRelief());
    const passes = finishPasses({ reliefFinishStrategy: 'raster-waterline' }, maskedDiscRelief());

    expect(levelLoops(raster)).toBe(0);
    expect(levelLoops(passes)).toBeGreaterThanOrEqual(3);
  });

  it('keeps climb on the physical bed through a mirrored placement or origin', () => {
    const mirrored = finishPasses(
      { reliefFinishStrategy: 'raster-waterline' },
      bossRelief({ ...IDENTITY_TRANSFORM, mirrorX: true }),
    );
    const frontRight = finishPasses({ reliefFinishStrategy: 'raster-waterline' }, bossRelief(), {
      ...DEFAULT_DEVICE_PROFILE,
      origin: 'front-right',
    });

    // A mirrored placement still cuts clockwise on the bed; a front-right
    // origin mirrors machine X, so clockwise on the bed reads anticlockwise.
    expect(waterlineTurn(mirrored)).toBeLessThan(0);
    expect(waterlineTurn(frontRight)).toBeGreaterThan(0);
  });
});
