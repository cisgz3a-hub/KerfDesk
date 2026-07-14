import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
  type SceneObject,
} from '../../core/scene';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
};

const readyController = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };

const sampleObject: SceneObject = {
  kind: 'imported-svg',
  id: 'controller-selection-test',
  source: 'controller-selection.svg',
  bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
  transform: IDENTITY_TRANSFORM,
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          points: [
            { x: 1, y: 1 },
            { x: 9, y: 9 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('Start controller selection policy', () => {
  it('allows the user-selected profile when detected firmware differs', () => {
    const result = prepareStartJob(projectFor('grbl-v1.1'), readyController, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'marlin',
    });

    expect(result.ok).toBe(true);
  });

  it('does not require reconnecting after the user selects another profile', () => {
    const result = prepareStartJob(projectFor('marlin'), readyController, {
      ...readyMachine,
      activeControllerKind: 'grbl-v1.1',
      detectedControllerKind: 'grbl-v1.1',
    });

    expect(result.ok).toBe(true);
  });

  it('also allows matching profile and controller identities', () => {
    const result = prepareStartJob(projectFor('grblhal'), readyController, {
      ...readyMachine,
      activeControllerKind: 'grblhal',
      detectedControllerKind: 'grblhal',
    });

    expect(result.ok).toBe(true);
  });
});

function projectFor(controllerKind: NonNullable<Project['device']['controllerKind']>): Project {
  const project = createProject();
  return {
    ...project,
    device: { ...project.device, controllerKind },
    scene: {
      ...EMPTY_SCENE,
      objects: [sampleObject],
      layers: [createLayer({ id: 'controller-selection-layer', color: '#ff0000' })],
    },
  };
}
