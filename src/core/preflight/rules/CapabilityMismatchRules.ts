/**
 * T3-57: profile-vs-live capability mismatch rules.
 *
 * The existing preflight already covers `$30` max-spindle (T1-33),
 * `$32` laser mode (T1-32), and the `$130/$131` bed dimensions check.
 * Audit 3C Finding 6.5 identified the remaining capability axes that
 * deserve preflight rules:
 *
 *   - `$22` (homing-enabled) — error: profile expects homing but
 *     firmware reports `$22=0`. Templates that emit `$H` will fail.
 *   - `$110` / `$111` (max feed rate per axis) — warning: profile
 *     max feed > firmware feed. Firmware will clamp; user gets
 *     slower-than-expected motion without an obvious cause.
 *   - `$120` / `$121` (max acceleration per axis) — warning: same
 *     as above but for acceleration.
 *   - Bed dimensions — warning when the profile expects a larger
 *     envelope than the firmware reports. The existing T1-33
 *     check covers blocker-severity off-bed motion; this check is
 *     the proactive "you'll hit a soft limit if your job extends
 *     past where firmware thinks the bed ends" surface.
 *
 * **This module is a pure rule function.** Wiring it into the live
 * preflight orchestrator is filed as a future T3-57 follow-up slice
 * once `runPreflight` threads `controllerRef.current?.getDeviceIdentity()`
 * through. Same foundation-first pattern T3-43 / T3-44 / T3-46 / T3-50
 * / T3-51 used.
 */

import type { DeviceIdentity } from '../../../controllers/ControllerInterface';
import type { DeviceProfile } from '../../devices/DeviceProfile';

export type CapabilityMismatchSeverity = 'warning' | 'error';

export type CapabilityMismatchCode =
  | 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH'
  | 'SOFT_LIMITS_PROFILE_VS_FIRMWARE_MISMATCH'
  | 'PROFILE_Z_TRAVEL_EXCEEDS_FIRMWARE'
  | 'PROFILE_FEED_X_EXCEEDS_FIRMWARE'
  | 'PROFILE_FEED_Y_EXCEEDS_FIRMWARE'
  | 'PROFILE_ACCEL_X_EXCEEDS_FIRMWARE'
  | 'PROFILE_ACCEL_Y_EXCEEDS_FIRMWARE'
  | 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE'
  | 'PROFILE_BED_HEIGHT_EXCEEDS_FIRMWARE';

export interface CapabilityMismatchFinding {
  readonly code: CapabilityMismatchCode;
  readonly severity: CapabilityMismatchSeverity;
  readonly message: string;
  readonly fix: string;
  readonly path: string;
}

/**
 * Tolerance for "essentially equal" feed / accel comparisons. Firmware
 * may round float settings by a single unit; one-unit slack avoids
 * spurious warnings.
 */
const COMPARE_EPS = 1.0;

/**
 * Pure rule function. Returns an array of structured findings. Empty
 * array means "no detected mismatches" — callers decide whether to
 * surface as preflight findings or to ignore (e.g. when the profile
 * is being edited and the user explicitly wants to override).
 *
 * Null fields on `identity` (firmware never reported the value) are
 * always skipped — fingerprint-based mismatches need both sides
 * populated.
 */
export function checkCapabilityMismatches(
  profile: DeviceProfile,
  identity: DeviceIdentity,
): readonly CapabilityMismatchFinding[] {
  const findings: CapabilityMismatchFinding[] = [];

  // Rule 1: $22 homing-enabled mismatch (error). When the profile
  // expects homing and the firmware reports `$22=0`, templates that
  // emit `$H` will fail. Block job start until the user resolves.
  if (
    profile.homingEnabled === true
    && identity.homingEnabled === false
  ) {
    findings.push({
      code: 'HOMING_PROFILE_VS_FIRMWARE_MISMATCH',
      severity: 'error',
      message:
        'Profile expects homing enabled, but firmware reports $22=0. Templates using $H will fail.',
      fix:
        'Either set $22=1 in the firmware (so $H homes the machine) or disable Homing in the profile if the machine has no limit switches.',
      path: 'profile.homingEnabled',
    });
  }

  if (
    profile.softLimitsEnabled === true
    && identity.softLimitsEnabled === false
  ) {
    findings.push({
      code: 'SOFT_LIMITS_PROFILE_VS_FIRMWARE_MISMATCH',
      severity: 'warning',
      message:
        'Profile expects GRBL soft limits enabled, but firmware reports $20=0. Firmware will not provide the configured soft-limit safety net.',
      fix:
        'Enable $20=1 after homing is configured, or disable Soft Limits in the profile if this machine intentionally runs without firmware soft limits.',
      path: 'profile.softLimitsEnabled',
    });
  }

  const profileZ = profile.zAxis;
  const firmwareZTravel = identity.zTravelMm;
  if (
    profileZ?.supported === true
    && Number.isFinite(profileZ.minMm)
    && Number.isFinite(profileZ.maxMm)
    && firmwareZTravel != null
    && firmwareZTravel > 0
  ) {
    const profileZSpan = Math.abs((profileZ.maxMm as number) - (profileZ.minMm as number));
    if (profileZSpan > firmwareZTravel + COMPARE_EPS) {
      findings.push({
        code: 'PROFILE_Z_TRAVEL_EXCEEDS_FIRMWARE',
        severity: 'warning',
        message:
          `Profile Z travel span (${profileZSpan} mm) exceeds firmware $132 (${firmwareZTravel} mm). Z-step jobs may alarm or move outside the configured Z envelope.`,
        fix:
          'Reduce the profile Z-axis min/max span to fit $132, or update $132 only after verifying the machine has that physical Z travel.',
        path: 'profile.zAxis',
      });
    }
  }

  // Rule 2 / 3: $110 / $111 feed rate exceeds firmware (warning).
  if (
    Number.isFinite(profile.maxRateX)
    && profile.maxRateX !== undefined
    && (profile.maxRateX as number) > 0
    && identity.maxRateXMmPerMin != null
    && identity.maxRateXMmPerMin > 0
    && (profile.maxRateX as number) > identity.maxRateXMmPerMin + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_FEED_X_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile X max feed (${profile.maxRateX} mm/min) exceeds firmware $110 (${identity.maxRateXMmPerMin} mm/min). Firmware will clamp.`,
      fix:
        'Lower the profile max X feed to match $110, or raise $110 in firmware if the mechanics allow it.',
      path: 'profile.maxRateX',
    });
  }
  if (
    Number.isFinite(profile.maxRateY)
    && profile.maxRateY !== undefined
    && (profile.maxRateY as number) > 0
    && identity.maxRateYMmPerMin != null
    && identity.maxRateYMmPerMin > 0
    && (profile.maxRateY as number) > identity.maxRateYMmPerMin + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_FEED_Y_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile Y max feed (${profile.maxRateY} mm/min) exceeds firmware $111 (${identity.maxRateYMmPerMin} mm/min). Firmware will clamp.`,
      fix:
        'Lower the profile max Y feed to match $111, or raise $111 in firmware if the mechanics allow it.',
      path: 'profile.maxRateY',
    });
  }

  // Rule 4 / 5: $120 / $121 acceleration exceeds firmware (warning).
  if (
    Number.isFinite(profile.maxAccelX)
    && profile.maxAccelX !== undefined
    && (profile.maxAccelX as number) > 0
    && identity.maxAccelXMmPerS2 != null
    && identity.maxAccelXMmPerS2 > 0
    && (profile.maxAccelX as number) > identity.maxAccelXMmPerS2 + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_ACCEL_X_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile X max accel (${profile.maxAccelX} mm/s²) exceeds firmware $120 (${identity.maxAccelXMmPerS2} mm/s²). Firmware will clamp.`,
      fix:
        'Lower the profile max X accel to match $120, or raise $120 in firmware if the mechanics allow it.',
      path: 'profile.maxAccelX',
    });
  }
  if (
    Number.isFinite(profile.maxAccelY)
    && profile.maxAccelY !== undefined
    && (profile.maxAccelY as number) > 0
    && identity.maxAccelYMmPerS2 != null
    && identity.maxAccelYMmPerS2 > 0
    && (profile.maxAccelY as number) > identity.maxAccelYMmPerS2 + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_ACCEL_Y_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile Y max accel (${profile.maxAccelY} mm/s²) exceeds firmware $121 (${identity.maxAccelYMmPerS2} mm/s²). Firmware will clamp.`,
      fix:
        'Lower the profile max Y accel to match $121, or raise $121 in firmware if the mechanics allow it.',
      path: 'profile.maxAccelY',
    });
  }

  // Rule 6 / 7: Bed dimensions exceed firmware envelope. Existing
  // T1-33 covers max-spindle mismatch as a blocker; this rule is the
  // proactive bed-envelope warning that surfaces "your profile claims
  // a larger bed than the firmware enforces", which leads to soft-limit
  // alarms mid-job for jobs that fit the profile bed but not the
  // firmware bed.
  if (
    profile.bedWidth > 0
    && identity.bedWidthMm != null
    && identity.bedWidthMm > 0
    && profile.bedWidth > identity.bedWidthMm + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_BED_WIDTH_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile bed width (${profile.bedWidth} mm) exceeds firmware $130 (${identity.bedWidthMm} mm). Jobs near the right edge may trigger a soft-limit alarm.`,
      fix:
        'Lower the profile bed width to match $130, or raise $130 in firmware if the mechanics allow it.',
      path: 'profile.bedWidth',
    });
  }
  if (
    profile.bedHeight > 0
    && identity.bedHeightMm != null
    && identity.bedHeightMm > 0
    && profile.bedHeight > identity.bedHeightMm + COMPARE_EPS
  ) {
    findings.push({
      code: 'PROFILE_BED_HEIGHT_EXCEEDS_FIRMWARE',
      severity: 'warning',
      message:
        `Profile bed height (${profile.bedHeight} mm) exceeds firmware $131 (${identity.bedHeightMm} mm). Jobs near the back edge may trigger a soft-limit alarm.`,
      fix:
        'Lower the profile bed height to match $131, or raise $131 in firmware if the mechanics allow it.',
      path: 'profile.bedHeight',
    });
  }

  return findings;
}

/** Convenience: any error-severity finding present? */
export function hasCapabilityMismatchError(
  findings: readonly CapabilityMismatchFinding[],
): boolean {
  return findings.some((f) => f.severity === 'error');
}
