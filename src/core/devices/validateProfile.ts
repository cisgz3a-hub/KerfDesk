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
const VALID_ORIGIN_CORNERS: ReadonlySet<string> = new Set([
  'front-left',
  'rear-left',
  'front-right',
  'rear-right',
]);

interface ProfileValidationInput {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly bedWidth?: unknown;
  readonly bedHeight?: unknown;
  readonly maxSpindle?: unknown;
  readonly grblLaserPowerMode?: unknown;
  readonly grblTransferMode?: unknown;
  readonly grblJogMode?: unknown;
  readonly airAssistCommand?: unknown;
  readonly serialSignals?: unknown;
  readonly watts?: unknown;
  readonly baudRate?: unknown;
  readonly originCorner?: unknown;
  readonly homeCorner?: unknown;
  readonly maxFeedRate?: unknown;
  readonly maxRateX?: unknown;
  readonly maxRateY?: unknown;
  readonly maxAccelX?: unknown;
  readonly maxAccelY?: unknown;
  readonly maxAccelMmPerS2?: unknown;
  readonly frameDotFeedRate?: unknown;
  readonly frameLineDelayMs?: unknown;
  readonly autoFocusSupported?: unknown;
  readonly autoFocusCommand?: unknown;
  readonly autoFocusTimeoutMs?: unknown;
  readonly scanningOffsets?: unknown;
  readonly zAxis?: unknown;
}

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

export function validateProfile(profile: ProfileValidationInput): ProfileValidationResult {
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
  if (typeof profile.originCorner !== 'string' || !VALID_ORIGIN_CORNERS.has(profile.originCorner)) {
    issues.push({
      field: 'originCorner',
      severity: 'error',
      code: 'PROFILE_ORIGIN_CORNER_INVALID',
      message: `originCorner must be one of front-left | rear-left | front-right | rear-right (got ${String(profile.originCorner)}).`,
    });
  }
  if (
    profile.homeCorner != null
    && (typeof profile.homeCorner !== 'string' || !VALID_ORIGIN_CORNERS.has(profile.homeCorner))
  ) {
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

  if (
    profile.grblLaserPowerMode != null
    && profile.grblLaserPowerMode !== 'dynamic-m4'
    && profile.grblLaserPowerMode !== 'constant-m3'
  ) {
    issues.push({
      field: 'grblLaserPowerMode',
      severity: 'error',
      code: 'PROFILE_GRBL_LASER_POWER_MODE_INVALID',
      message: `GRBL laser power mode must be dynamic-m4 or constant-m3 when set (got ${String(profile.grblLaserPowerMode)}).`,
    });
  }
  if (
    profile.grblTransferMode != null
    && profile.grblTransferMode !== 'buffered'
    && profile.grblTransferMode !== 'synchronous'
  ) {
    issues.push({
      field: 'grblTransferMode',
      severity: 'error',
      code: 'PROFILE_GRBL_TRANSFER_MODE_INVALID',
      message: `GRBL transfer mode must be buffered or synchronous when set (got ${String(profile.grblTransferMode)}).`,
    });
  }
  if (
    profile.grblJogMode != null
    && profile.grblJogMode !== 'grbl-j'
    && profile.grblJogMode !== 'legacy-gcode'
  ) {
    issues.push({
      field: 'grblJogMode',
      severity: 'error',
      code: 'PROFILE_GRBL_JOG_MODE_INVALID',
      message: `GRBL jog mode must be grbl-j or legacy-gcode when set (got ${String(profile.grblJogMode)}).`,
    });
  }
  if (
    profile.airAssistCommand != null
    && profile.airAssistCommand !== 'M7'
    && profile.airAssistCommand !== 'M8'
    && profile.airAssistCommand !== 'none'
  ) {
    issues.push({
      field: 'airAssistCommand',
      severity: 'error',
      code: 'PROFILE_AIR_ASSIST_COMMAND_INVALID',
      message: `Air assist command must be M7, M8, or none when set (got ${String(profile.airAssistCommand)}).`,
    });
  }
  if (profile.serialSignals != null) {
    const signals = profile.serialSignals as { dataTerminalReady?: unknown; requestToSend?: unknown };
    if (typeof profile.serialSignals !== 'object' || Array.isArray(profile.serialSignals)) {
      issues.push({
        field: 'serialSignals',
        severity: 'error',
        code: 'PROFILE_SERIAL_SIGNALS_INVALID',
        message: 'serialSignals must be an object when set.',
      });
    } else if (
      (signals.dataTerminalReady != null && typeof signals.dataTerminalReady !== 'boolean')
      || (signals.requestToSend != null && typeof signals.requestToSend !== 'boolean')
    ) {
      issues.push({
        field: 'serialSignals',
        severity: 'error',
        code: 'PROFILE_SERIAL_SIGNALS_INVALID',
        message: 'serialSignals.dataTerminalReady and serialSignals.requestToSend must be booleans when set.',
      });
    }
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
  // T1-172 (audit F-017): allow 0 (disable delay) but reject negative
  // and non-finite values. Match the resolver semantics: 0 is a valid
  // explicit choice.
  if (
    profile.frameLineDelayMs != null
    && !isNonNegativeFinite(profile.frameLineDelayMs)
  ) {
    issues.push({
      field: 'frameLineDelayMs',
      severity: 'error',
      code: 'PROFILE_FRAME_LINE_DELAY_MS_INVALID',
      message: `frameLineDelayMs must be a non-negative finite number when set (got ${String(profile.frameLineDelayMs)}).`,
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
  if (typeof profile.baudRate !== 'number' || !VALID_BAUD.has(profile.baudRate)) {
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
  const disabledAutofocusTimeout =
    profile.autoFocusSupported === false &&
    (profile.autoFocusCommand ?? '') === '' &&
    profile.autoFocusTimeoutMs === 0;
  if (profile.autoFocusTimeoutMs != null && !disabledAutofocusTimeout) {
    if (
      !isPositiveFinite(profile.autoFocusTimeoutMs)
      || (typeof profile.autoFocusTimeoutMs === 'number' && profile.autoFocusTimeoutMs > 5 * 60 * 1000)
    ) {
      issues.push({
        field: 'autoFocusTimeoutMs',
        severity: 'error',
        code: 'PROFILE_AUTOFOCUS_TIMEOUT_INVALID',
        message: `autoFocusTimeoutMs must be a positive finite number ≤ 5 minutes (got ${String(profile.autoFocusTimeoutMs)}).`,
      });
    }
  }

  if (profile.scanningOffsets != null) {
    if (!Array.isArray(profile.scanningOffsets)) {
      issues.push({
        field: 'scanningOffsets',
        severity: 'error',
        code: 'PROFILE_SCANNING_OFFSETS_INVALID',
        message: 'Scanning offsets must be an array when set.',
      });
    } else {
      profile.scanningOffsets.forEach((entry, index) => {
        const row = entry as { speedMmPerMin?: unknown; offsetMm?: unknown };
        if (
          typeof entry !== 'object'
          || entry == null
          || !isPositiveFinite(row.speedMmPerMin)
          || typeof row.offsetMm !== 'number'
          || !Number.isFinite(row.offsetMm)
          || Math.abs(row.offsetMm) > 25
        ) {
          issues.push({
            field: `scanningOffsets[${index}]`,
            severity: 'error',
            code: 'PROFILE_SCANNING_OFFSET_ROW_INVALID',
            message: 'Scanning offset rows must have a positive finite speed and finite offset within +/-25 mm.',
          });
        }
      });
    }
  }

  if (profile.zAxis != null) {
    const zAxis = profile.zAxis as { supported?: unknown; minMm?: unknown; maxMm?: unknown };
    if (typeof profile.zAxis !== 'object' || Array.isArray(profile.zAxis) || typeof zAxis.supported !== 'boolean') {
      issues.push({
        field: 'zAxis',
        severity: 'error',
        code: 'PROFILE_Z_AXIS_INVALID',
        message: 'zAxis must be an object with a boolean supported field when set.',
      });
    } else if (zAxis.supported) {
      if (
        typeof zAxis.minMm !== 'number'
        || typeof zAxis.maxMm !== 'number'
        || !Number.isFinite(zAxis.minMm)
        || !Number.isFinite(zAxis.maxMm)
        || zAxis.minMm > zAxis.maxMm
      ) {
        issues.push({
          field: 'zAxis',
          severity: 'error',
          code: 'PROFILE_Z_AXIS_RANGE_INVALID',
          message: 'Supported Z-axis profiles must define finite minMm and maxMm with minMm <= maxMm.',
        });
      }
    }
  }

  const ok = issues.every(i => i.severity !== 'error');
  return { ok, issues };
}
