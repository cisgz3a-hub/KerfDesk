import { describe, expect, it } from 'vitest';
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

const color = '#ff0000';

function square(id: string, at: number, manual: boolean): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    bounds: { minX: at, minY: 20, maxX: at + 20, maxY: 40 },
    transform: IDENTITY_TRANSFORM,
    paths: [
      {
        color,
        polylines: [
          {
            closed: true,
            points: [
              { x: at, y: 20 },
              { x: at + 20, y: 20 },
              { x: at + 20, y: 40 },
              { x: at, y: 40 },
            ],
          },
        ],
      },
    ],
    ...(manual
      ? {
          cncTabAnchors: [
            { layerColor: color, pathIndex: 0, polylineIndex: 0, pathT: 0.05 },
            { layerColor: color, pathIndex: 0, polylineIndex: 0, pathT: 0.55 },
          ],
        }
      : {}),
  };
}

function scene(objects: ReadonlyArray<ImportedSvg>, finishAllowanceMm = 0): Scene {
  const layer = {
    ...createLayer({ id: 'L1', color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'profile-outside' as const,
      depthMm: 6,
      depthPerPassMm: 3,
      finishAllowanceMm,
      tabsEnabled: true,
      tabHeightMm: 2,
      tabWidthMm: 6,
      tabsPerShape: 4,
    },
  };
  return { layers: [layer], objects };
}

// Since ADR-258 a tabbed deep pass is ONE path3d that rises to the tab top at each
// tab, rather than N open contour pieces. Counting rises is the direct translation
// of the old "count the open pieces" measure — a loop with N tabs has N rises — so
// the expected counts below are unchanged from the split model.
const DEEPEST_Z_MM = -6;
const Z_EPS = 1e-9;

function deepestTabRiseCount(input: Scene): number {
  const job = compileCncJob(input, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected CNC group');
  let rises = 0;
  for (const pass of group.passes) {
    if (pass.kind !== 'path3d') continue;
    const deepest = pass.points.reduce((min, point) => Math.min(min, point.z), Infinity);
    if (Math.abs(deepest - DEEPEST_Z_MM) > Z_EPS) continue;
    for (let index = 1; index < pass.points.length; index += 1) {
      const previous = pass.points[index - 1];
      const current = pass.points[index];
      if (previous === undefined || current === undefined) continue;
      if (current.z > previous.z + Z_EPS) rises += 1;
    }
  }
  return rises;
}

describe('compileCncJob manual tabs', () => {
  it('uses persisted anchors instead of automatic spacing', () => {
    expect(deepestTabRiseCount(scene([square('manual', 20, true)]))).toBe(2);
  });

  it('keeps automatic tabs on untouched objects in the same layer', () => {
    expect(
      deepestTabRiseCount(scene([square('manual', 20, true), square('automatic', 100, false)])),
    ).toBe(6);
  });

  it('projects the same manual anchors onto roughing and finishing contours', () => {
    expect(deepestTabRiseCount(scene([square('manual', 20, true)], 2))).toBe(4);
  });
});
