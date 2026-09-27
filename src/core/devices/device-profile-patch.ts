import type { DeviceProfile } from './device-profile';
import { isScanOffsetTableForProfile } from './scan-offset-profile';

// Interactive profile edits must never leave the optional controlled seek
// feed above the machine feed ceiling. Import and preflight paths deliberately
// do not use this helper so malformed persisted profiles are still rejected.
export function deviceProfileWithInteractivePatch(
  current: DeviceProfile,
  patch: Partial<DeviceProfile>,
): DeviceProfile {
  const patched: DeviceProfile = { ...current, ...patch };
  // A measured travel confirmation belongs to that value. Controller-detected
  // travel may replace it without going through the manual Z editor, so never
  // inherit the old confirmation for different travel. An explicit confirmation
  // in this patch is a new operator assertion and remains possible.
  const next: DeviceProfile =
    patched.zTravelMm !== current.zTravelMm && patch.zTravelConfirmed !== true
      ? { ...patched, zTravelConfirmed: false }
      : patched;
  const scanIdentityChanged = scanCalibrationIdentity(current) !== scanCalibrationIdentity(next);
  // A bed edit changes the profile-relative scan-offset ceiling. Never retain
  // a partly valid calibration: clear the whole table and lifecycle status so
  // the operator must recalibrate against the new machine geometry.
  const scanTableIsValid = isScanOffsetTableForProfile(next.scanningOffsets, next);
  const hasOrphanCalibrationStatus =
    next.scanningOffsets.length === 0 && next.scanOffsetCalibrationStatus !== undefined;
  const scanSafe =
    !scanIdentityChanged && scanTableIsValid && !hasOrphanCalibrationStatus
      ? next
      : { ...next, scanningOffsets: [], scanOffsetCalibrationStatus: undefined };
  const controlledFeed = scanSafe.controlledLaserOffTravelFeedMmPerMin;
  if (controlledFeed === undefined) return scanSafe;
  if (!positiveFinite(scanSafe.maxFeed) || !positiveFinite(controlledFeed)) {
    return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: undefined };
  }
  if (controlledFeed <= scanSafe.maxFeed) return scanSafe;
  return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: scanSafe.maxFeed };
}

function scanCalibrationIdentity(profile: DeviceProfile): string {
  const head = profile.laserSubProfile;
  return JSON.stringify([
    profile.controllerKind ?? 'grbl-v1.1',
    profile.gcodeDialect.dialectId,
    head?.model,
    head?.technology,
    head?.opticalPowerW,
    head?.wavelengthNm,
    head?.spotSizeMm,
  ]);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
