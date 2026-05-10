/**
 * T1-126: pure parser + interpreter for GRBL `$N=value` setting
 * lines. Extracted from `GrblController._parseDollarSetting` as the
 * second slice of the audit's Sprint 4 "extract pure parsers first"
 * sequence (T1-124 was the status-report parser).
 *
 * The original `_parseDollarSetting` was 60 lines mixing regex
 * matching, settings-map storage, and per-setting interpretation
 * (e.g. `$30` → maxSpindle, `$32` → laserMode boolean, `$130/$131`
 * → bed dimensions, `$120/$121` → max acceleration). Testing the
 * interpretation rules required driving the whole controller; the
 * regex was duplicated awkwardly with the switch-on-number block.
 *
 * This module exposes two pure functions:
 *
 *   `parseGrblSettingLine(line)` — line → `{ number, rawValue }` | null
 *   `interpretGrblSettingValue(num, rawValue)` — known settings →
 *     typed `InterpretedGrblSetting` (only fills the field for
 *     settings the parser knows; preserves the original gate
 *     semantics like "$30 only updates if positive finite").
 *
 * The caller (controller) reads both and applies side effects
 * unchanged. Behavior is byte-identical to the pre-T1-126 inline
 * implementation.
 */

const GRBL_SETTING_LINE = /^\$(\d+)=(.+)$/;

export interface ParsedGrblSetting {
  /** Setting number, e.g. 10, 30, 130. */
  readonly number: number;
  /** Raw value string, trimmed. The interpreter knows how to coerce
   *  per-setting (parseFloat for $30, parseInt for $32 boolean,
   *  etc.). Stored verbatim in the controller's settings map for
   *  surfaces that want the literal protocol value. */
  readonly rawValue: string;
}

/**
 * Per-setting interpreted view. Only the fields for settings this
 * parser knows are populated — every other field stays undefined.
 *
 * Numeric gates preserve the pre-T1-126 inline behavior:
 *   - `$30` (maxSpindle): only set when parseFloat is finite AND > 0
 *   - `$120/$121` (max accel): only set when parseFloat is finite AND > 0
 *   - `$110/$111` (max feed) + `$130/$131` (bed): set when finite
 *     (negative values pass through — the live controller didn't
 *     gate these and we preserve that)
 *   - `$23` (homing dir): parseInt, defaults 0 on NaN
 *   - `$32` (laser mode): truthy when parseInt !== 0; an
 *     unparseable value lands as false
 */
export interface InterpretedGrblSetting {
  /** $23 — homing-cycle direction. Always present after parse;
   *  defaults to 0 when rawValue is unparseable (matches `parseInt
   *  || 0` from the pre-fix code). */
  readonly homingDir?: number;
  /** $30 — max spindle / PWM. Only set when parseFloat is finite and > 0. */
  readonly maxSpindle?: number;
  /** $32 — laser-mode boolean. parseInt(rawValue) !== 0 (NaN → false). */
  readonly laserMode?: boolean;
  /** $130 — bed width (mm). Set when parseFloat is finite. */
  readonly bedWidth?: number;
  /** $131 — bed height (mm). Set when parseFloat is finite. */
  readonly bedHeight?: number;
  /** $110 — max X feed (mm/min). Set when parseFloat is finite. */
  readonly maxFeedX?: number;
  /** $111 — max Y feed (mm/min). Set when parseFloat is finite. */
  readonly maxFeedY?: number;
  /** $120 — max X accel (mm/s²). Only set when parseFloat is finite and > 0. */
  readonly maxAccelX?: number;
  /** $121 — max Y accel (mm/s²). Only set when parseFloat is finite and > 0. */
  readonly maxAccelY?: number;
}

/**
 * Match a `$N=value` line and split into number + trimmed raw value.
 * Returns null when the line is anything else (a $$-listing-end
 * trailing `ok`, an `error:`, a status report, etc.).
 */
export function parseGrblSettingLine(line: string): ParsedGrblSetting | null {
  const m = line.match(GRBL_SETTING_LINE);
  if (!m) return null;
  const num = parseInt(m[1], 10);
  const rawValue = m[2].trim();
  if (!Number.isFinite(num)) return null;
  return { number: num, rawValue };
}

/**
 * Apply per-setting interpretation rules. Caller is expected to
 * also store `(number, rawValue)` in its raw settings map for
 * surfaces that read by setting number directly (`$10` mask,
 * `$22` homing-enable, etc. — settings the controller doesn't
 * pre-interpret).
 */
export function interpretGrblSettingValue(
  num: number,
  rawValue: string,
): InterpretedGrblSetting {
  const out: {
    homingDir?: number;
    maxSpindle?: number;
    laserMode?: boolean;
    bedWidth?: number;
    bedHeight?: number;
    maxFeedX?: number;
    maxFeedY?: number;
    maxAccelX?: number;
    maxAccelY?: number;
  } = {};
  switch (num) {
    case 23: {
      // pre-fix: parseInt(rawVal, 10) || 0 — NaN coerces to 0.
      const v = parseInt(rawValue, 10);
      out.homingDir = Number.isFinite(v) ? v : 0;
      break;
    }
    case 30: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v) && v > 0) out.maxSpindle = v;
      break;
    }
    case 32: {
      out.laserMode = parseInt(rawValue, 10) !== 0;
      break;
    }
    case 110: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v)) out.maxFeedX = v;
      break;
    }
    case 111: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v)) out.maxFeedY = v;
      break;
    }
    case 120: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v) && v > 0) out.maxAccelX = v;
      break;
    }
    case 121: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v) && v > 0) out.maxAccelY = v;
      break;
    }
    case 130: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v)) out.bedWidth = v;
      break;
    }
    case 131: {
      const v = parseFloat(rawValue);
      if (Number.isFinite(v)) out.bedHeight = v;
      break;
    }
    default:
      break;
  }
  return out;
}
