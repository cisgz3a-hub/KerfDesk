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
import type { JobPlacementSettings } from '../job-placement';
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
const readyController = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const headPosition = { x: 120, y: 80 };
const currentPosition: JobPlacementSettings = {
  startFrom: 'current-position',
  anchor: 'center',
};
const object: SceneObject = {
  kind: 'traced-image',
  id: 'trace',
  source: 'logo.png',
  bounds: { minX: 0, minY: 0, maxX: 50, maxY: 30 },
  transform: { ...IDENTITY_TRANSFORM, x: 175, y: 185 },
  paths: [
    {
      color: '#ff0000',
      polylines: [
        {
          closed: true,
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 0 },
            { x: 50, y: 30 },
            { x: 0, y: 30 },
          ],
        },
      ],
    },
  ],
};

function project(): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: false } },
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

function machine(position: { readonly x: number; readonly y: number }) {
  return {
    statusReport: { ...idleStatus, mPos: { ...position, z: 0 } },
    alarmCode: null,
    hasActiveStreamer: false,
    frameVerification: null,
  };
}

describe('no-homing relative Frame policy', () => {
  it('allows Current Position Start without Frame', () => {
    const result = prepareStartJob(
      project(),
      readyController,
      machine(headPosition),
      currentPosition,
    );
    expect(result.ok).toBe(true);
  });

  it('continues to allow Current Position Start after a jog without Frame', () => {
    expect(
      prepareStartJob(project(), readyController, machine({ x: 130, y: 80 }), currentPosition).ok,
    ).toBe(true);
  });
});
