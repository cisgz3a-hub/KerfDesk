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

function deepestOpenPassCount(input: Scene): number {
  const job = compileCncJob(input, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('expected CNC group');
  return group.passes.filter((pass) => pass.kind === 'contour' && pass.zMm === -6 && !pass.closed)
    .length;
}

describe('compileCncJob manual tabs', () => {
  it('uses persisted anchors instead of automatic spacing', () => {
    expect(deepestOpenPassCount(scene([square('manual', 20, true)]))).toBe(2);
  });

  it('keeps automatic tabs on untouched objects in the same layer', () => {
    expect(
      deepestOpenPassCount(scene([square('manual', 20, true), square('automatic', 100, false)])),
    ).toBe(6);
  });

  it('projects the same manual anchors onto roughing and finishing contours', () => {
    expect(deepestOpenPassCount(scene([square('manual', 20, true)], 2))).toBe(4);
  });
});
