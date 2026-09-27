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
