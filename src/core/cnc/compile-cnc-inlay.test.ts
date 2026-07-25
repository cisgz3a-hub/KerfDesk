import { describe, expect, it } from 'vitest';
import type { CncContourPass, CncPass } from '../job';
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

function inlayScene(tabsEnabled = true): Scene {
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
      tabsEnabled,
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

// Depth and X of any pass kind: a tabbed pass is a path3d (ADR-258), a led pass is
// too (ADR-250), so neither can be read as a contour.
function passZs(pass: CncPass): ReadonlyArray<number> {
  if (pass.kind === 'path3d') return pass.points.map((point) => point.z);
  if (pass.kind === 'contour') return [pass.zMm];
  return [];
}

function passXs(pass: CncPass): ReadonlyArray<number> {
  if (pass.kind === 'path3d') return pass.points.map((point) => point.x);
  if (pass.kind === 'contour') return pass.polyline.map((point) => point.x);
  return [];
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
    // ADR-258: the male insert is a tabbed profile, so its deep passes are path3d
    // Z-rises rather than contour passes — read depth and X from either kind.
    expect(Math.min(...male.passes.flatMap(passZs))).toBe(-6.35);
    const femaleMaxX = Math.max(
      ...female.passes.flatMap((pass) => contour(pass).polyline.map((point) => point.x)),
    );
    const maleMinX = Math.min(...male.passes.flatMap(passXs));
    expect(maleMinX).toBeGreaterThan(femaleMaxX);
  });

  // Audit 1.12: the inlay pair builds its groups directly instead of through
  // cncGroupForLayer, so the default-on ADR-250 lead never reached the male
  // insert — it plunged full-depth onto the wall that has to fit the pocket.
  it('leads the male insert in instead of plunging onto its fit wall', () => {
    const job = compileCncJob(
      inlayScene(false),
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    const female = job.groups[0];
    const male = job.groups[1];
    if (female?.kind !== 'cnc' || male?.kind !== 'cnc') throw new Error('expected CNC groups');
    // ADR-250 turns each closed untabbed profile pass into a led path3d that
    // enters in the waste and arrives tangentially.
    expect(male.passes.every((pass) => pass.kind === 'path3d')).toBe(true);
    // The lead is profile-only, so the female pocket keeps plain contours.
    expect(female.passes.every((pass) => pass.kind === 'contour')).toBe(true);
  });
});
