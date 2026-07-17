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
import { frameVerificationForProject } from './frame-verification-testing';
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

// Frame-first (ADR-228): the camera Start gates (absolute-mode requirement,
// home / position-epoch proof) are deleted entirely — not even demoted to
// warnings. The watched Frame trace is the placement proof; the camera panel
// keeps its own in-panel confirmation UI.
describe('Start camera-placement integration', () => {
  it('starts a camera-placed job on a relative origin once framed', () => {
    const project = cameraProject(true);
    const wco = { x: 15, y: 25, z: 0 };
    const result = prepareStartJob(
      project,
      READY_CONTROLLER,
      {
        ...READY_MACHINE,
        cameraPlacementActive: true,
        homingState: 'confirmed',
        workOriginActive: true,
        wcoCache: wco,
        frameVerification: frameVerificationForProject(project, {
          jobOrigin: { startFrom: 'user-origin', anchor: 'front-left' },
          wco,
          workOriginActive: true,
        }),
      },
      { startFrom: 'user-origin', anchor: 'front-left' },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).not.toContain(CAMERA_ABSOLUTE_COORDINATES_MESSAGE);
    }
  });

  it('starts without a completed Home on a homing-capable machine once framed', () => {
    const project = cameraProject(true);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).not.toContain(CAMERA_HOME_REQUIRED_MESSAGE);
    }
  });

  it('starts without an epoch-bound confirmation on a no-homing machine once framed', () => {
    const project = cameraProject(false);
    const result = prepareStartJob(project, READY_CONTROLLER, {
      ...READY_MACHINE,
      cameraPlacementActive: true,
      homingState: 'unknown',
      trustedPositionEpoch: 9,
      cameraConfirmedPositionEpoch: 8,
      frameVerification: frameVerificationForProject(project),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings).not.toContain(CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE);
    }
  });
});
