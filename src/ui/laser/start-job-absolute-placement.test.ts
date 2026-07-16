import { describe, expect, it } from 'vitest';
import type { StatusReport } from '../../core/controllers/grbl';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import { ABSOLUTE_HOME_REQUIRED_MESSAGE } from './absolute-placement-safety';
import { prepareStartJob } from './start-job-readiness';

const idleStatus: StatusReport = {
  state: 'Idle',
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  wco: null,
  feed: 0,
  spindle: 0,
};

const controller = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const readyMachine = { statusReport: idleStatus, alarmCode: null, hasActiveStreamer: false };

function homingProject(): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: true } },
    scene: {
      ...EMPTY_SCENE,
      objects: [
        {
          kind: 'imported-svg',
          id: 'line',
          source: 'line.svg',
          bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 0, y: 0 },
                    { x: 10, y: 10 },
                  ],
                },
              ],
            },
          ],
        },
      ],
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
    },
  };
}

describe('Start safety for Absolute Coordinates', () => {
  it('blocks until the homing laser is homed in this connection', () => {
    const project = homingProject();
    const blocked = prepareStartJob(project, controller, {
      ...readyMachine,
      homingState: 'unknown',
    });
    expect(blocked).toEqual({ ok: false, messages: [ABSOLUTE_HOME_REQUIRED_MESSAGE] });

    const ready = prepareStartJob(project, controller, {
      ...readyMachine,
      homingState: 'confirmed',
    });
    expect(ready.ok).toBe(true);
  });

  it('keeps Current Position available without automatic homing', () => {
    const result = prepareStartJob(
      homingProject(),
      controller,
      { ...readyMachine, homingState: 'unknown' },
      { startFrom: 'current-position', anchor: 'front-left' },
    );

    expect(result.ok).toBe(true);
  });
});
