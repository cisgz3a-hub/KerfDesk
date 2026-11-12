import type { DeviceProfile } from './device-profile';
import { positioningLightSupported } from './positioning-light';
import { powerScaleStatementDescribes } from './power-scale-statement';
import { isScanOffsetTableForProfile } from './scan-offset-profile';
import { isFinitePositive } from '../util/finite';

// Interactive profile edits must never leave the optional controlled seek
// feed above the machine feed ceiling. Import and preflight paths deliberately
// do not use this helper so malformed persisted profiles are still rejected.
export function deviceProfileWithInteractivePatch(
  current: DeviceProfile,
  patch: Partial<DeviceProfile>,
): DeviceProfile {
  const patched = withoutStalePowerScaleStatement(
    withoutUnsupportedLight({ ...current, ...patch }),
  );
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
  if (!isFinitePositive(scanSafe.maxFeed) || !isFinitePositive(controlledFeed)) {
    return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: undefined };
  }
  if (controlledFeed <= scanSafe.maxFeed) return scanSafe;
  return { ...scanSafe, controlledLaserOffTravelFeedMmPerMin: scanSafe.maxFeed };
}

// Switching to a Marlin fan-mosfet dialect removes the positioning light: its
// laser is on the fan output, so no LED command may ever be sent there.
function withoutUnsupportedLight(profile: DeviceProfile): DeviceProfile {
  if (profile.positioningLight === undefined) return profile;
  if (positioningLightSupported(profile.gcodeDialect.dialectId)) return profile;
  const { positioningLight: _removed, ...rest } = profile;
  return rest;
}

// The operator's power-scale statement is about one Full-power S on one
// controller family and output dialect (ADR-095 Amendment 1). An edit to any
// of them removes it, so putting the old value back does not bring it back.
function withoutStalePowerScaleStatement(profile: DeviceProfile): DeviceProfile {
  const statement = profile.operatorPowerScaleStatement;
  if (statement === undefined || powerScaleStatementDescribes(statement, profile)) return profile;
  const { operatorPowerScaleStatement: _stale, ...rest } = profile;
  return rest;
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
