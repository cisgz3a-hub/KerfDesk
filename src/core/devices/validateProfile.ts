/**
 * T2-39: strict profile validation on save.
 *
 * Pre-T2-39, profiles were user-editable and `saveDeviceProfile` accepted
 * any object that matched the type signature. Concrete failure modes the
 * audit highlighted (Audit 3C Finding 5.1 / Required Priority 9):
 *
 *   - bedWidth = 0 or negative — silently accepted; later surfaces as
 *     "preflight bed=0" / planner divides by zero.
 *   - maxSpindle = 0 — all-S-values evaluate to 0, no engraving.
 *   - maxSpindle = NaN / Infinity — silently accepted; encodePowerValue
 *     produces NaN S-values that propagate into the gcode stream.
 *   - originCorner = arbitrary string (via storage edit) — silently
 *     accepted; downstream transform-corner logic uses a default that
 *     may not match the user's actual machine.
 *   - autoFocusCommand containing arbitrary G-code — silently
 *     accepted; a malicious or careless template can include `M3 S1000`
 *     (laser-on outside test-fire context), `$X` (alarm-clear without
 *     consent), `G10` (silent WCS rewrite) or destructive realtime
 *     bytes.
 *   - maxFeedRate / maxRateX / maxRateY / maxAccel* negative — silently
 *     accepted; downstream planner produces nonsense.
 *
 * `validateProfile` returns a per-field issue list. Severity is `'error'`
 * for hard rejections (save MUST refuse) and `'warning'` for shape-OK-but-
 * suspicious values that the user might still want despite the
 * validator's preference. Callers (today: `saveDeviceProfile`; future:
 * Settings UI) can surface error-severity issues per-field.
 *
 * Pure function. No React, no storage, no logging. Easy to unit test
 * against arbitrary profile shapes.
 */
import type { DeviceProfile, MachineOriginCorner } from './DeviceProfile';

export type ProfileValidationSeverity = 'error' | 'warning';

export interface ProfileValidationIssue {
  field: string;
  severity: ProfileValidationSeverity;
  code: string;
  message: string;
}

export interface ProfileValidationResult {
  ok: boolean;
  issues: ProfileValidationIssue[];
}

const MAX_BED_MM = 5000; // 5 m — beyond any consumer/prosumer laser.
const MAX_SPINDLE = 65535; // 16-bit PWM ceiling — typical microcontroller upper bound.
const VALID_BAUD = new Set([9600, 19200, 38400, 57600, 115200, 230400, 250000]);
const VALID_ORIGIN_CORNERS: ReadonlySet<MachineOriginCorner> = new Set([
  'front-left',
  'rear-left',
  'front-right',
  'rear-right',
]);

/** True for a finite number > 0 within an inclusive upper bound. */
function isPositiveFinite(n: unknown, max?: number): boolean {
  if (typeof n !== 'number') return false;
  if (!Number.isFinite(n)) return false;
  if (n <= 0) return false;
  if (max != null && n > max) return false;
  return true;
}

/** True for a finite number ≥ 0 within an inclusive upper bound. */
function isNonNegativeFinite(n: unknown, max?: number): boolean {
  if (typeof n !== 'number') return false;
  if (!Number.isFinite(n)) return false;
  if (n < 0) return false;
  if (max != null && n > max) return false;
  return true;
}

/**
 * Subset of GcodeTemplateValidator's banned tokens that apply to
 * autofocus templates specifically. Autofocus runs unattended; the
 * dangerous-token list is conservative.
 *
 * - `$X` clears alarm without user consent.
 * - `$H` triggers homing — fine standalone but not as part of a probe.
 * - `M3` / `M4` turn the laser on outside the test-fire / job-start
 *   M-state contract.
 * - `G10` rewrites WCS silently (T1-1 covers this for the connect path,
 *   but the autofocus template is a separate write surface).
 * - `M2` / `M30` end the program — would prematurely terminate.
 * - Realtime bytes (0x18 reset, 0x21 hold, 0x7E cycle-start) are
 *   not valid in template text but check anyway.
 */
const FORBIDDEN_AUTOFOCUS_TOKENS = [
  /\$X\b/i,
  /\$H\b/i,
  /\bM3\b/i,
  /\bM4\b/i,
  /\bG10\b/i,
  /\bM2\b/i,
  /\bM30\b/i,
  /[\x18\x21\x7E]/,
];

export function validateProfile(profile: DeviceProfile): ProfileValidationResult {
  const issues: ProfileValidationIssue[] = [];

  // ── Identity ──
  if (typeof profile.id !== 'string' || profile.id.length === 0) {
    issues.push({
      field: 'id',
      severity: 'error',
      code: 'PROFILE_ID_MISSING',
      message: 'Profile id is required.',
    });
  }
  if (typeof profile.name !== 'string' || profile.name.trim().length === 0) {
    issues.push({
      field: 'name',
      severity: 'error',
      code: 'PROFILE_NAME_BLANK',
      message: 'Profile name cannot be blank.',
    });
  }

  // ── Bed dimensions ──
  if (!isPositiveFinite(profile.bedWidth, MAX_BED_MM)) {
    issues.push({
      field: 'bedWidth',
      severity: 'error',
      code: 'PROFILE_BED_WIDTH_INVALID',
      message: `bedWidth must be a positive finite number ≤ ${MAX_BED_MM} mm (got ${String(profile.bedWidth)}).`,
    });
  }
  if (!isPositiveFinite(profile.bedHeight, MAX_BED_MM)) {
    issues.push({
      field: 'bedHeight',
      severity: 'error',
      code: 'PROFILE_BED_HEIGHT_INVALID',
      message: `bedHeight must be a positive finite number ≤ ${MAX_BED_MM} mm (got ${String(profile.bedHeight)}).`,
    });
  }

  // ── Origin corner ──
  if (!VALID_ORIGIN_CORNERS.has(profile.originCorner as MachineOriginCorner)) {
    issues.push({
      field: 'originCorner',
      severity: 'error',
      code: 'PROFILE_ORIGIN_CORNER_INVALID',
      message: `originCorner must be one of front-left | rear-left | front-right | rear-right (got ${String(profile.originCorner)}).`,
    });
  }
  if (profile.homeCorner != null && !VALID_ORIGIN_CORNERS.has(profile.homeCorner as MachineOriginCorner)) {
    issues.push({
      field: 'homeCorner',
      severity: 'error',
      code: 'PROFILE_HOME_CORNER_INVALID',
      message: `homeCorner must be one of front-left | rear-left | front-right | rear-right when set (got ${String(profile.homeCorner)}).`,
    });
  }

  // ── maxSpindle ──
  if (!isPositiveFinite(profile.maxSpindle, MAX_SPINDLE)) {
    issues.push({
      field: 'maxSpindle',
      severity: 'error',
      code: 'PROFILE_MAX_SPINDLE_INVALID',
      message: `maxSpindle must be a positive finite number ≤ ${MAX_SPINDLE} (got ${String(profile.maxSpindle)}).`,
    });
  }

  // ── Feed rates ──
  if (!isPositiveFinite(profile.maxFeedRate)) {
    issues.push({
      field: 'maxFeedRate',
      severity: 'error',
      code: 'PROFILE_MAX_FEED_RATE_INVALID',
      message: `maxFeedRate must be a positive finite number (got ${String(profile.maxFeedRate)}).`,
    });
  }
  if (profile.frameDotFeedRate != null && !isPositiveFinite(profile.frameDotFeedRate)) {
    issues.push({
      field: 'frameDotFeedRate',
      severity: 'error',
      code: 'PROFILE_FRAME_DOT_FEED_RATE_INVALID',
      message: `frameDotFeedRate must be a positive finite number when set (got ${String(profile.frameDotFeedRate)}).`,
    });
  }
  if (profile.maxRateX != null && !isPositiveFinite(profile.maxRateX)) {
    issues.push({
      field: 'maxRateX',
      severity: 'error',
      code: 'PROFILE_MAX_RATE_X_INVALID',
      message: `maxRateX must be a positive finite number when set (got ${String(profile.maxRateX)}).`,
    });
  }
  if (profile.maxRateY != null && !isPositiveFinite(profile.maxRateY)) {
    issues.push({
      field: 'maxRateY',
      severity: 'error',
      code: 'PROFILE_MAX_RATE_Y_INVALID',
      message: `maxRateY must be a positive finite number when set (got ${String(profile.maxRateY)}).`,
    });
  }

  // ── Accelerations ──
  if (profile.maxAccelX != null && !isPositiveFinite(profile.maxAccelX)) {
    issues.push({
      field: 'maxAccelX',
      severity: 'error',
      code: 'PROFILE_MAX_ACCEL_X_INVALID',
      message: `maxAccelX must be a positive finite number when set (got ${String(profile.maxAccelX)}).`,
    });
  }
  if (profile.maxAccelY != null && !isPositiveFinite(profile.maxAccelY)) {
    issues.push({
      field: 'maxAccelY',
      severity: 'error',
      code: 'PROFILE_MAX_ACCEL_Y_INVALID',
      message: `maxAccelY must be a positive finite number when set (got ${String(profile.maxAccelY)}).`,
    });
  }
  if (profile.maxAccelMmPerS2 != null && !isPositiveFinite(profile.maxAccelMmPerS2)) {
    issues.push({
      field: 'maxAccelMmPerS2',
      severity: 'error',
      code: 'PROFILE_MAX_ACCEL_INVALID',
      message: `maxAccelMmPerS2 must be a positive finite number when set (got ${String(profile.maxAccelMmPerS2)}).`,
    });
  }

  // ── Baud rate ──
  if (!VALID_BAUD.has(profile.baudRate)) {
    issues.push({
      field: 'baudRate',
      severity: 'error',
      code: 'PROFILE_BAUD_RATE_INVALID',
      message: `baudRate must be one of ${[...VALID_BAUD].join(', ')} (got ${String(profile.baudRate)}).`,
    });
  }

  // ── Watts (warning, not error — some user setups don't know exact wattage) ──
  if (!isNonNegativeFinite(profile.watts)) {
    issues.push({
      field: 'watts',
      severity: 'warning',
      code: 'PROFILE_WATTS_INVALID',
      message: `watts should be a non-negative finite number (got ${String(profile.watts)}).`,
    });
  }

  // ── Autofocus command (safety-touching) ──
  if (typeof profile.autoFocusCommand === 'string' && profile.autoFocusCommand.length > 0) {
    for (const pattern of FORBIDDEN_AUTOFOCUS_TOKENS) {
      if (pattern.test(profile.autoFocusCommand)) {
        issues.push({
          field: 'autoFocusCommand',
          severity: 'error',
          code: 'PROFILE_AUTOFOCUS_FORBIDDEN_TOKEN',
          message:
            `autoFocusCommand contains a forbidden token (${pattern.source}). ` +
            'Autofocus runs unattended; the command may not include $X, $H, M3, M4, G10, M2, M30, or realtime bytes.',
        });
        break; // one error per command is enough
      }
    }
  }

  // ── autoFocusTimeoutMs (warn on absurd values) ──
  if (profile.autoFocusTimeoutMs != null) {
    if (!isPositiveFinite(profile.autoFocusTimeoutMs) || profile.autoFocusTimeoutMs > 5 * 60 * 1000) {
      issues.push({
        field: 'autoFocusTimeoutMs',
        severity: 'error',
        code: 'PROFILE_AUTOFOCUS_TIMEOUT_INVALID',
        message: `autoFocusTimeoutMs must be a positive finite number ≤ 5 minutes (got ${String(profile.autoFocusTimeoutMs)}).`,
      });
    }
  }

  const ok = issues.every(i => i.severity !== 'error');
  return { ok, issues };
}
