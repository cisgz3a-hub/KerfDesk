import { expect, it } from 'vitest';
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
import { findCncHelicalEntryIssues } from './cnc-helical-issues';

const color = '#2563eb';
const square: ImportedSvg = {
  kind: 'imported-svg',
  id: 'pocket',
  source: 'pocket.svg',
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

function passes(scene: Scene) {
  const job = compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
  expect(job.groups).toHaveLength(1);
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('Expected the pocket CNC group.');
  return group.passes;
}

it('keeps the ordinary pocket depth ladder when a sub-floor helix is disclosed', () => {
  const layer = {
    ...createLayer({ id: 'pocket-op', color }),
    cnc: {
      ...DEFAULT_CNC_LAYER_SETTINGS,
      cutType: 'pocket' as const,
      tabsEnabled: false,
      depthMm: 2,
      depthPerPassMm: 1,
    },
  };
  const ordinary = passes({ objects: [square], layers: [layer] });
  const scene: Scene = {
    objects: [square],
    layers: [
      {
        ...layer,
        cnc: { ...layer.cnc, helixEntry: { minDiameterMm: 2, maxDiameterMm: 8, angleDeg: 0.2 } },
      },
    ],
  };

  expect(passes(scene)).toEqual(ordinary);
  expect(ordinary.length).toBeGreaterThan(0);
  expect(
    findCncHelicalEntryIssues(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG),
  ).toEqual([
    { layerId: 'pocket-op', reason: expect.stringMatching(/0\.5 degrees.*plunge entry/) },
  ]);
});
