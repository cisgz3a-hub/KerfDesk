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

const readyController = {
  maxPowerS: 1000,
  minPowerS: 0,
  laserModeEnabled: true,
};

const readyMachine = {
  statusReport: idleStatus,
  alarmCode: null,
  hasActiveStreamer: false,
};

const currentPositionCenter: JobPlacementSettings = {
  startFrom: 'current-position',
  anchor: 'center',
};

const userOriginFrontLeft: JobPlacementSettings = {
  startFrom: 'user-origin',
  anchor: 'front-left',
};

const centeredTraceObject: SceneObject = {
  kind: 'traced-image',
  id: 'centered-trace',
  source: 'centered-logo.png',
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
            { x: 0, y: 0 },
          ],
        },
      ],
    },
  ],
};

function fillOverscanProject(): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'fill-near-origin',
          source: 'fill.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: true,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [
        {
          ...createLayer({ id: 'L-fill', color: '#ff0000', mode: 'fill' }),
          fillOverscanMm: 5,
          hatchSpacingMm: 2,
          power: 10,
        },
      ],
    },
  };
}

describe('prepareStartJob job placement', () => {
  it('places the selected anchor at the current machine position for Current Position jobs', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      {
        ...readyMachine,
        statusReport: {
          ...idleStatus,
          mPos: { x: 120, y: 80, z: 0 },
          wPos: null,
        },
      },
      currentPositionCenter,
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.gcode).toContain('X95.000 Y95.000');
      expect(result.gcode).toContain('X145.000 Y95.000');
    }
  });

  it('blocks User Origin when the operator has not set a custom origin', () => {
    const result = prepareStartJob(
      calibratedProjectWith(centeredTraceObject),
      readyController,
      readyMachine,
      userOriginFrontLeft,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/set origin/i);
    }
  });

  it('names fill overscan when an absolute fill job is too close to the bed edge', () => {
    const result = prepareStartJob(fillOverscanProject(), readyController, readyMachine);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.messages.join('\n')).toMatch(/overscan/i);
      expect(result.messages.join('\n')).toMatch(/5 mm/);
    }
  });
});

function calibratedProjectWith(object: SceneObject): Project {
  return {
    ...createProject(),
    scene: {
      ...EMPTY_SCENE,
      objects: [object],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}
