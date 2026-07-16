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
      ['Profile', 1, [1]],
      ['Pocket', 2, [2]],
    ]);
  });

  it('shows requested CNC positions alongside clearing-before-profile steps', () => {
    const project = projectWithJobs('cnc');

    expect(
      artworkRunOrderRows(project).map((row) => [row.name, row.position, row.effectiveSteps]),
    ).toEqual([
      ['Profile', 1, [2]],
      ['Pocket', 2, [1]],
    ]);
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
      objects: [object('profile-object', 'profile', 10), object('pocket-object', 'pocket', 40)],
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

function object(id: string, operationId: string, x: number): SceneObject {
  return {
    ...createRectangle({
      id,
      color: '#000000',
      spec: { widthMm: 10, heightMm: 10, cornerRadiusMm: 0 },
    }),
    operationIds: [operationId],
    transform: { ...IDENTITY_TRANSFORM, x, y: 10 },
  };
}
