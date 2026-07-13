import { describe, expect, it } from 'vitest';
import type { CncContourPass } from '../job';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { compileCncJob } from './compile-cnc-job';

function inlayScene(): Scene {
  const color = '#ff0000';
  const layer = {
    ...createLayer({ id: 'L1', color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'inlay-pair' as const,
      depthMm: 6.35,
      depthPerPassMm: 2,
      inlayPocketDepthMm: 3,
      inlayAllowanceMm: 0.1,
      inlayPairSpacingMm: 10,
      tabsEnabled: true,
    },
  };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'O1',
    source: 'square.svg',
    bounds: { minX: 50, minY: 50, maxX: 80, maxY: 80 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 50, y: 50 },
              { x: 80, y: 50 },
              { x: 80, y: 80 },
              { x: 50, y: 80 },
            ],
          },
        ],
      },
    ],
  };
  return { layers: [layer], objects: [object] };
}

function contour(pass: unknown): CncContourPass {
  if (typeof pass !== 'object' || pass === null || !('kind' in pass) || pass.kind !== 'contour') {
    throw new Error('expected contour pass');
  }
  return pass as CncContourPass;
}

describe('compileCncJob inlay pair', () => {
  it('cuts a radius-matched pocket before its mirrored tabbed insert', () => {
    const job = compileCncJob(inlayScene(), DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    expect(job.groups).toHaveLength(2);
    const female = job.groups[0];
    const male = job.groups[1];
    if (female?.kind !== 'cnc' || male?.kind !== 'cnc') throw new Error('expected CNC groups');
    expect(female.cutType).toBe('pocket');
    expect(male.cutType).toBe('profile-outside');
    expect(Math.min(...female.passes.map((pass) => contour(pass).zMm))).toBe(-3);
    expect(Math.min(...male.passes.map((pass) => contour(pass).zMm))).toBe(-6.35);
    const femaleMaxX = Math.max(
      ...female.passes.flatMap((pass) => contour(pass).polyline.map((point) => point.x)),
    );
    const maleMinX = Math.min(
      ...male.passes.flatMap((pass) => contour(pass).polyline.map((point) => point.x)),
    );
    expect(maleMinX).toBeGreaterThan(femaleMaxX);
  });
});
