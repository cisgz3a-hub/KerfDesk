import { describe, expect, it } from 'vitest';
import { compileCncJob } from '../cnc';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import {
  DEFAULT_CNC_MACHINE_CONFIG,
  DEFAULT_CNC_LAYER_SETTINGS,
  IDENTITY_TRANSFORM,
  bindSceneObjectToOperations,
  createLayer,
  type ImportedSvg,
  type Scene,
} from '../scene';
import { compileJob } from './compile-job';

const firstOperation = {
  ...createLayer({ id: 'johann-op', name: 'Johann', color: '#2563eb' }),
  power: 20,
  speed: 900,
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 700, depthMm: 1 },
};
const secondOperation = {
  ...createLayer({ id: 'box-op', name: 'Box', color: '#dc2626' }),
  power: 70,
  speed: 1800,
  cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, feedMmPerMin: 1400, depthMm: 2 },
};

describe('operation-bound compilation', () => {
  it('compiles same-colored artwork with independent laser settings', () => {
    const job = compileJob(independentScene(), DEFAULT_DEVICE_PROFILE);
    expect(job.groups).toHaveLength(2);
    const groups = job.groups.filter((group) => group.kind !== 'cnc');
    expect(groups.map((group) => [group.layerId, group.power, group.speed])).toEqual([
      ['johann-op', 20, 900],
      ['box-op', 70, 1800],
    ]);
  });

  it('compiles the same bindings with independent CNC settings', () => {
    const job = compileCncJob(
      independentScene(),
      DEFAULT_DEVICE_PROFILE,
      DEFAULT_CNC_MACHINE_CONFIG,
    );
    expect(job.groups).toHaveLength(2);
    const groups = job.groups.filter((group) => group.kind === 'cnc');
    expect(groups.map((group) => [group.layerId, group.feedMmPerMin])).toEqual([
      ['johann-op', 700],
      ['box-op', 1400],
    ]);
  });

  it('emits one shared group after artwork intentionally uses one operation', () => {
    const scene = independentScene();
    const shared: Scene = {
      ...scene,
      objects: scene.objects.map((object) => bindSceneObjectToOperations(object, ['johann-op'])),
    };
    const laser = compileJob(shared, DEFAULT_DEVICE_PROFILE);
    const cnc = compileCncJob(shared, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG);
    expect(laser.groups).toHaveLength(1);
    expect(laser.groups[0]).toMatchObject({ layerId: 'johann-op', power: 20 });
    expect(cnc.groups).toHaveLength(1);
    expect(cnc.groups[0]).toMatchObject({ layerId: 'johann-op', feedMmPerMin: 700 });
  });
});

function independentScene(): Scene {
  return {
    objects: [artwork('johann', 'johann-op', 0), artwork('box', 'box-op', 20)],
    layers: [firstOperation, secondOperation],
    groups: [],
  };
}

function artwork(id: string, operationId: string, x: number): ImportedSvg {
  return {
    kind: 'imported-svg',
    id,
    source: `${id}.svg`,
    operationIds: [operationId],
    bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    transform: { ...IDENTITY_TRANSFORM, x },
    paths: [
      {
        color: '#000000',
        polylines: [
          {
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
            ],
            closed: false,
          },
        ],
      },
    ],
  };
}
