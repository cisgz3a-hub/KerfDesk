import type { JobStartMode } from '../../core/job';
import type { HomingState } from '../state/laser-store';

export const CAMERA_ABSOLUTE_COORDINATES_MESSAGE =
  'Camera placement uses physical bed coordinates. Keep Start from set to Absolute Coordinates; User Origin or Current Position would shift the job away from the camera image.';

export const CAMERA_HOME_REQUIRED_MESSAGE =
  'Camera placement needs a trusted machine position. Home the machine in this session before framing or starting the job.';

export const CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE =
  'Camera placement needs a confirmed controller-to-bed position. In Camera, confirm that the controller coordinates still match the camera-aligned bed before framing or starting.';

export const CAMERA_GEOMETRY_REQUIRED_PREFIX = 'Camera placement geometry is not ready.';

export type CameraPlacementSafetySnapshot = {
  readonly active: boolean;
  readonly startFrom: JobStartMode;
  readonly homingEnabled: boolean;
  readonly homingState: HomingState;
  readonly trustedPositionEpoch: number;
  readonly confirmedPositionEpoch: number | null;
  readonly geometryIssue?: string | null;
};

/**
 * Camera-to-bed alignment is meaningful only in the bed's absolute coordinate
 * frame. Homing-capable machines must establish that frame through a completed
 * Home in this session. A no-homing machine has no automatic proof, so the
 * operator confirmation is bound to the controller position epoch and expires
 * on reconnect, reset, alarm, sleep, or another homing attempt.
 */
export function cameraPlacementSafetyIssue(snapshot: CameraPlacementSafetySnapshot): string | null {
  if (!snapshot.active) return null;
  if (snapshot.startFrom !== 'absolute') return CAMERA_ABSOLUTE_COORDINATES_MESSAGE;
  if (snapshot.geometryIssue !== undefined && snapshot.geometryIssue !== null) {
    return `${CAMERA_GEOMETRY_REQUIRED_PREFIX} ${snapshot.geometryIssue}`;
  }
  if (snapshot.homingEnabled) {
    return snapshot.homingState === 'confirmed' ? null : CAMERA_HOME_REQUIRED_MESSAGE;
  }
  return snapshot.confirmedPositionEpoch === snapshot.trustedPositionEpoch
    ? null
    : CAMERA_POSITION_CONFIRMATION_REQUIRED_MESSAGE;
}
