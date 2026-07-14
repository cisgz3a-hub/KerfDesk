import { describe, expect, it } from 'vitest';
import {
  CAMERA_ABSOLUTE_COORDINATES_MESSAGE,
  CAMERA_HOME_REQUIRED_MESSAGE,
  CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE,
  cameraPlacementSafetyIssue,
  type CameraPlacementSafetySnapshot,
} from './camera-placement-safety';

const READY: CameraPlacementSafetySnapshot = {
  active: true,
  startFrom: 'absolute',
  homingEnabled: true,
  homingState: 'confirmed',
  trustedPositionEpoch: 4,
  confirmedPositionEpoch: null,
};

describe('cameraPlacementSafetyIssue', () => {
  it('does not affect jobs that are not camera-placed', () => {
    expect(
      cameraPlacementSafetyIssue({
        ...READY,
        active: false,
        startFrom: 'user-origin',
        homingState: 'unknown',
      }),
    ).toBeNull();
  });

  it('refuses every relative-origin mode while camera placement is active', () => {
    expect(cameraPlacementSafetyIssue({ ...READY, startFrom: 'user-origin' })).toBe(
      CAMERA_ABSOLUTE_COORDINATES_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue({ ...READY, startFrom: 'current-position' })).toBe(
      CAMERA_ABSOLUTE_COORDINATES_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue({ ...READY, startFrom: 'verified-origin' })).toBe(
      CAMERA_ABSOLUTE_COORDINATES_MESSAGE,
    );
  });

  it('requires a completed Home in this session on a homing-capable machine', () => {
    expect(cameraPlacementSafetyIssue({ ...READY, homingState: 'unknown' })).toBe(
      CAMERA_HOME_REQUIRED_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue({ ...READY, homingState: 'homing' })).toBe(
      CAMERA_HOME_REQUIRED_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue(READY)).toBeNull();
  });

  it('requires a fresh epoch-bound confirmation on a no-homing machine', () => {
    const noHoming = { ...READY, homingEnabled: false, homingState: 'unknown' as const };
    expect(cameraPlacementSafetyIssue(noHoming)).toBe(
      CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue({ ...noHoming, confirmedPositionEpoch: 3 })).toBe(
      CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE,
    );
    expect(cameraPlacementSafetyIssue({ ...noHoming, confirmedPositionEpoch: 4 })).toBeNull();
  });

  it('blocks active placement when the current camera surface geometry is unusable', () => {
    expect(cameraPlacementSafetyIssue({ ...READY, geometryIssue: 'Re-align the camera.' })).toBe(
      'Camera placement geometry is not ready. Re-align the camera.',
    );
  });
});
