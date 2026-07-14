import { describe, expect, it } from 'vitest';
import {
  createLayer,
  createProject,
  EMPTY_SCENE,
  IDENTITY_TRANSFORM,
  type Project,
} from '../../core/scene';
import {
  CAMERA_ABSOLUTE_COORDINATES_MESSAGE,
  CAMERA_HOME_REQUIRED_MESSAGE,
  CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE,
} from '../camera/camera-placement-safety';
import { prepareStartJob } from './start-job-readiness';

const READY_CONTROLLER = { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true };
const IDLE_STATUS = {
  state: 'Idle' as const,
  subState: null,
  mPos: { x: 0, y: 0, z: 0 },
  wPos: null,
  feed: 0,
  spindle: 0,
  wco: null,
};
const READY_MACHINE = { statusReport: IDLE_STATUS, alarmCode: null, hasActiveStreamer: false };

function cameraProject(homingEnabled: boolean): Project {
  const base = createProject();
  return {
    ...base,
    device: { ...base.device, homing: { ...base.device.homing, enabled: homingEnabled } },
    scene: {
      ...EMPTY_SCENE,
      layers: [{ ...createLayer({ id: 'L1', color: '#ff0000' }), power: 10 }],
      objects: [
        {
          kind: 'imported-svg',
          id: 'camera-part',
          source: 'camera-part.svg',
          bounds: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
          transform: IDENTITY_TRANSFORM,
          paths: [
            {
              color: '#ff0000',
              polylines: [
                {
                  closed: false,
                  points: [
                    { x: 10, y: 10 },
                    { x: 20, y: 20 },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  };
}

describe('Start camera-placement integration', () => {
  it('refuses a camera-placed job changed back to a relative origin', () => {
    const result = prepareStartJob(
      cameraProject(true),
      READY_CONTROLLER,
      { ...READY_MACHINE, cameraPlacementActive: true, homingState: 'confirmed' },
      { startFrom: 'user-origin', anchor: 'front-left' },
    );
    expect(result).toEqual({ ok: false, messages: [CAMERA_ABSOLUTE_COORDINATES_MESSAGE] });
  });

  it('requires and accepts a completed Home on a homing-capable machine', () => {
    const project = cameraProject(true);
    const blocked = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
    });
    expect(blocked).toEqual({ ok: false, messages: [CAMERA_HOME_REQUIRED_MESSAGE] });

    const ready = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'confirmed',
    });
    expect(ready.ok).toBe(true);
  });

  it('requires a current epoch-bound confirmation on a no-homing machine', () => {
    const project = cameraProject(false);
    const blocked = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      trustedPositionEpoch: 9,
      cameraConfirmedPositionEpoch: 8,
    });
    expect(blocked).toEqual({
      ok: false,
      messages: [CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE],
    });

    const ready = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      trustedPositionEpoch: 9,
      cameraConfirmedPositionEpoch: 9,
    });
    expect(ready.ok).toBe(true);
  });
});
