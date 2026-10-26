import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../../../core/cnc/compile-cnc-job';
import { DEFAULT_DEVICE_PROFILE } from '../../../core/devices';
import {
  createLayer,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type CncLayerSettings,
  type ImportedSvg,
  type Layer,
} from '../../../core/scene';
import { cncOperationDetail } from './job-review-detail-facts';

/** The distinct depths the compiler cuts one 40 mm square at, top first. */
function compiledLevels(settings: CncLayerSettings): ReadonlyArray<number> {
  const layer: Layer = { ...createLayer({ id: 'levels', color: '#123456' }), cnc: settings };
  const object: ImportedSvg = {
    kind: 'imported-svg',
    id: 'levels-art',
    source: 'square.svg',
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    operationIds: [layer.id],
    paths: [
      {
        color: layer.color,
        polylines: [
          {
            closed: true,
            points: [
              { x: 30, y: 30 },
              { x: 70, y: 30 },
              { x: 70, y: 70 },
              { x: 30, y: 70 },
            ],
          },
        ],
      },
    ],
  };
  const job = compileCncJob(
    { objects: [object], layers: [layer] },
    DEFAULT_DEVICE_PROFILE,
    DEFAULT_CNC_MACHINE_CONFIG,
  );
  // A pass that rises over tabs or ramps in is a path3d at its lowest Z.
  const levels = job.groups.flatMap((group) =>
    group.kind === 'cnc'
      ? group.passes.map((pass) =>
          pass.kind === 'path3d' ? Math.min(...pass.points.map((point) => point.z)) : pass.zMm,
        )
      : [],
  );
  return [...new Set(levels.map((z) => Math.round(z * 1e6) / 1e6))].sort((a, b) => b - a);
}

// CNC audit v1 F4-P3-1: a closed tabbed profile is also cut at the tab top, so
// 6 mm at 2.5 mm per pass with 2 mm tabs steps -2.5, -4, -5 and -6. Job Review
// used to say 3 passes.
describe('Job Review pass count', () => {
  const tabbed: CncLayerSettings = {
    ...DEFAULT_CNC_LAYER_SETTINGS,
    cutType: 'profile-outside',
    depthMm: 6,
    depthPerPassMm: 2.5,
    tabsEnabled: true,
    tabHeightMm: 2,
  };

  it('counts the tab-top level the compiler adds to a closed tabbed profile', () => {
    expect(compiledLevels(tabbed)).toEqual([-2.5, -4, -5, -6]);
    expect(cncOperationDetail(tabbed, undefined, [], undefined, false, true)).toMatch(
      /^4 passes · /,
    );
    expect(cncOperationDetail(tabbed)).toMatch(/^4 passes · /);
  });

  it('keeps the plain ladder where no tab level is cut', () => {
    // Compiled passes that rise into no tab cut only open paths.
    expect(cncOperationDetail(tabbed, undefined, [], undefined, false, false)).toMatch(
      /^3 passes · /,
    );
    const untabbed = { ...tabbed, tabsEnabled: false };
    expect(compiledLevels(untabbed)).toEqual([-2.5, -5, -6]);
    expect(cncOperationDetail(untabbed)).toMatch(/^3 passes · /);
    // A tab top that falls on a level adds none.
    const onLevel = { ...tabbed, depthMm: 7 };
    expect(compiledLevels(onLevel)).toEqual([-2.5, -5, -7]);
    expect(cncOperationDetail(onLevel)).toMatch(/^3 passes · /);
  });
});
