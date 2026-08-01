import type { DeviceProfile } from './device-profile';
import { isScanOffsetTableForProfile } from './scan-offset-profile';

// Interactive profile edits must never leave the optional controlled seek
// feed above the machine feed ceiling. Import and preflight paths deliberately
// do not use this helper so malformed persisted profiles are still rejected.
export function deviceProfileWithInteractivePatch(
  current: DeviceProfile,
  patch: Partial<DeviceProfile>,
): DeviceProfile {
  const next: DeviceProfile = { ...current, ...patch };
  // A rectified homography is solved in pixels produced by one lens model.
  // Replacing that model makes an inherited mapping stale.
  const cameraSafe = profileWithoutStaleRectifiedAlignment(current, patch, next);
  // A bed edit changes the profile-relative scan-offset ceiling. Never retain
  // a partly valid calibration: clear the whole table and lifecycle status so
  // the operator must recalibrate against the new machine geometry.
  const scanTableIsValid = isScanOffsetTableForProfile(cameraSafe.scanningOffsets, cameraSafe);
  const hasOrphanCalibrationStatus =
    cameraSafe.scanningOffsets.length === 0 && cameraSafe.scanOffsetCalibrationStatus !== undefined;
  const scanSafe =
    scanTableIsValid && !hasOrphanCalibrationStatus
      ? cameraSafe
      : { ...cameraSafe, scanningOffsets: [], scanOffsetCalibrationStatus: undefined };
  const controlledFeed = scanSafe.controlledLaserOffTravelFeedMmPerMin;
  if (controlledFeed === undefined) return scanSafe;
  if (!positiveFinite(scanSafe.maxFeed) || !positiveFinite(controlledFeed)) {
    return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: undefined };
  }
  if (controlledFeed <= scanSafe.maxFeed) return scanSafe;
  return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: scanSafe.maxFeed };
}

function profileWithoutStaleRectifiedAlignment(
  current: DeviceProfile,
  patch: Partial<DeviceProfile>,
  next: DeviceProfile,
): DeviceProfile {
  if (
    next.cameraCalibration === current.cameraCalibration ||
    Object.hasOwn(patch, 'cameraAlignment') ||
    current.cameraAlignment?.basis !== 'rectified'
  ) {
    return next;
  }
  const { cameraAlignment: _staleAlignment, ...withoutAlignment } = next;
  return withoutAlignment;
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
