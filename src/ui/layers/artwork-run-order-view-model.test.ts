import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  DEFAULT_CNC_LAYER_SETTINGS,
  DEFAULT_CNC_MACHINE_CONFIG,
  IDENTITY_TRANSFORM,
  type Layer,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { createRectangle } from '../../core/shapes/primitives';
import { artworkRunOrderRows } from './artwork-run-order-view-model';

describe('artwork run order view model', () => {
  it('reports exact laser output steps in requested order', () => {
    const project = projectWithJobs('laser');

    expect(
      artworkRunOrderRows(project).map((row) => [row.name, row.position, row.effectiveSteps]),
    ).toEqual([
      ['Lid', 1, [1]],
      ['Tray', 2, [2]],
    ]);
  });

  it('names each run by its artwork and keeps the operation as its summary', () => {
    const project = projectWithJobs('laser');

    expect(artworkRunOrderRows(project).map((row) => [row.name, row.operationSummary])).toEqual([
      ['Lid', 'Profile'],
      ['Tray', 'Pocket'],
    ]);
  });

  it('numbers artwork that shares a name, in canvas order, so each run has its own name', () => {
    const base = projectWithJobs('laser');
    const [lid, tray] = base.scene.objects;
    const unnamed = (object: SceneObject | undefined): SceneObject => {
      if (object === undefined) throw new Error('fixture object missing');
      return Object.fromEntries(
        Object.entries(object).filter(([key]) => key !== 'name'),
      ) as SceneObject;
    };
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [unnamed(lid), unnamed(tray)],
        artworkOrder: ['pocket-object', 'profile-object'],
      },
    };

    expect(artworkRunOrderRows(project).map((row) => [row.position, row.name])).toEqual([
      [1, 'Rectangle (2)'],
      [2, 'Rectangle (1)'],
    ]);
  });

  it('gives a composed shared-run name its run number when another run has the same name', () => {
    const base = projectWithJobs('laser');
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        objects: [
          object('a', 'profile', 10, 'Foo'),
          object('b', 'profile', 30, 'Foo'),
          object('c', 'pocket', 50, 'Foo (1) + 1 more'),
        ],
        artworkOrder: ['a', 'b', 'c'],
      },
    };

    const names = artworkRunOrderRows(project).map((row) => row.name);
    expect(names).toEqual(['Foo (1) + 1 more (run 1)', 'Foo (1) + 1 more (run 2)']);
    expect(new Set(names).size).toBe(names.length);
  });

  it('shows requested CNC positions alongside clearing-before-profile steps', () => {
    const project = projectWithJobs('cnc');

    expect(
      artworkRunOrderRows(project).map((row) => [row.name, row.position, row.effectiveSteps]),
    ).toEqual([
      ['Lid', 1, [2]],
      ['Tray', 2, [1]],
    ]);
  });

  it('labels flowing V-carve depth without presenting the ignored depth setting', () => {
    const base = projectWithJobs('cnc');
    const project: Project = {
      ...base,
      scene: {
        ...base.scene,
        layers: base.scene.layers.map((layer, index) =>
          index !== 0
            ? layer
            : {
                ...layer,
                cnc: {
                  ...(layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS),
                  cutType: 'v-carve' as const,
                  depthMm: 1,
                  vCarveFlatDepthEnabled: false,
                },
              },
        ),
      },
    };

    const summary = artworkRunOrderRows(project)[0]?.settingsSummary ?? '';
    expect(summary).toContain('flowing geometry depth');
    expect(summary).not.toContain('· 1 mm ·');
  });
});

function projectWithJobs(machine: 'laser' | 'cnc'): Project {
  const base = createProject();
  const profile = operation('profile', 'Profile', 'profile-outside', '#2563eb');
  const pocket = operation('pocket', 'Pocket', 'pocket', '#dc2626');
  return {
    ...base,
    ...(machine === 'cnc' ? { machine: DEFAULT_CNC_MACHINE_CONFIG } : {}),
    scene: {
      objects: [
        object('profile-object', 'profile', 10, 'Lid'),
        object('pocket-object', 'pocket', 40, 'Tray'),
      ],
      layers: [profile, pocket],
      artworkOrder: ['profile-object', 'pocket-object'],
    },
  };
}

function operation(
  id: string,
  name: string,
  cutType: 'profile-outside' | 'pocket',
  color: string,
): Layer {
  return {
    ...createLayer({ id, name, color }),
    cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType },
  };
}

function object(id: string, operationId: string, x: number, name: string): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    name,
    operationIds: [operationId],
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  };
}
