/**
 * T3-24: ingestion pipeline for community-submitted material response
 * curves.
 *
 * The audit's calibrated-preset library wants per-material luminance →
 * power response curves for common materials (3mm birch ply, anodized
 * aluminum, leather, etc.). Generating those curves requires hardware
 * — running a calibration grid on each material and extracting the
 * observed darkness at each commanded power. The audit explicitly
 * notes "Possibly leverage community submissions over time" as an
 * alternative to internal hardware testing.
 *
 * **This module ships only the ingestion pipeline.** It defines the
 * versioned JSON envelope a community contributor exports from their
 * own LaserForge install (or hand-authors), the validator, and the
 * adapter that converts a validated submission into the canonical
 * `ResponseCurve` shape. No curve data is shipped — actual calibrated
 * curves come from real hardware testing or community submissions.
 *
 * The shipped foundation lets the next user with a Falcon A1 Pro
 * (or any other GRBL laser) export a curve as JSON and share it.
 * Future T3-24 follow-up slices add a UI surface for importing the
 * JSON, a community-curve registry, and bundled calibrated curves
 * once enough submissions accumulate.
 */

import type { ResponseCurve, ResponseCurvePoint } from './ResponseCurve';

/** JSON envelope version. Increment on breaking shape changes. */
export const COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION = 1;

/**
 * Versioned envelope for community-submitted curves. Each submission
 * carries machine attribution so a future curve registry can group by
 * laser model and watt rating; user attribution is optional and
 * defaults to anonymous so contributors aren't required to identify
 * themselves to share calibration data.
 */
export interface CommunityResponseCurveEnvelope {
  readonly format: 'laserforge-community-response-curve';
  readonly formatVersion: number;
  /** Material display name (e.g. "3mm birch plywood"). */
  readonly materialName: string;
  /** Scan speed used for the calibration, mm/min. */
  readonly calibrationSpeed: number;
  /** Optional machine attribution. */
  readonly machine?: {
    readonly brand?: string;
    readonly model?: string;
    /** Diode wattage (display, not optical). */
    readonly watts?: number;
  };
  /** Optional contributor attribution. */
  readonly contributor?: {
    readonly name?: string;
    readonly url?: string;
  };
  /** ISO-8601 timestamp when the curve was captured. */
  readonly calibratedAt: string;
  /** Optional note (batch, supplier, lighting, etc.). */
  readonly note?: string;
  /**
   * Sampled (commandedPower, observedDarkness) points sorted by
   * commandedPower ascending. Validators enforce the sort.
   */
  readonly points: readonly ResponseCurvePoint[];
}

export type CommunityCurveValidationCode =
  | 'wrong-format'
  | 'unsupported-format-version'
  | 'missing-material-name'
  | 'invalid-calibration-speed'
  | 'invalid-calibrated-at'
  | 'too-few-points'
  | 'point-out-of-range'
  | 'points-not-sorted'
  | 'duplicate-power-point';

export interface CommunityCurveValidationIssue {
  readonly code: CommunityCurveValidationCode;
  readonly message: string;
  readonly path: string;
}

export interface CommunityCurveValidationResult {
  readonly ok: boolean;
  readonly issues: readonly CommunityCurveValidationIssue[];
}

const MIN_POINTS = 4;

/**
 * Type-safe runtime validator. Accepts `unknown` (from `JSON.parse`
 * of a user-supplied file) and returns either a structured success
 * result or a list of issues with paths suitable for UI display.
 */
export function validateCommunityResponseCurve(
  candidate: unknown,
): CommunityCurveValidationResult {
  const issues: CommunityCurveValidationIssue[] = [];

  if (typeof candidate !== 'object' || candidate === null) {
    return {
      ok: false,
      issues: [
        {
          code: 'wrong-format',
          message: 'Submission must be a JSON object.',
          path: '$',
        },
      ],
    };
  }
  const obj = candidate as Record<string, unknown>;

  if (obj.format !== 'laserforge-community-response-curve') {
    issues.push({
      code: 'wrong-format',
      message:
        'Submission `format` field must be the literal "laserforge-community-response-curve".',
      path: 'format',
    });
  }

  const v = typeof obj.formatVersion === 'number' ? obj.formatVersion : NaN;
  if (!Number.isFinite(v) || v !== COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION) {
    issues.push({
      code: 'unsupported-format-version',
      message: `Unsupported formatVersion ${String(obj.formatVersion)} (expected ${COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION}).`,
      path: 'formatVersion',
    });
  }

  if (typeof obj.materialName !== 'string' || obj.materialName.trim().length === 0) {
    issues.push({
      code: 'missing-material-name',
      message: 'materialName is required and must be a non-empty string.',
      path: 'materialName',
    });
  }

  const speed = typeof obj.calibrationSpeed === 'number' ? obj.calibrationSpeed : NaN;
  if (!Number.isFinite(speed) || speed <= 0) {
    issues.push({
      code: 'invalid-calibration-speed',
      message: 'calibrationSpeed must be a positive number (mm/min).',
      path: 'calibrationSpeed',
    });
  }

  if (
    typeof obj.calibratedAt !== 'string'
    || Number.isNaN(Date.parse(obj.calibratedAt))
  ) {
    issues.push({
      code: 'invalid-calibrated-at',
      message: 'calibratedAt must be a valid ISO-8601 timestamp.',
      path: 'calibratedAt',
    });
  }

  const points = Array.isArray(obj.points) ? obj.points : null;
  if (points === null) {
    issues.push({
      code: 'too-few-points',
      message: 'points must be an array.',
      path: 'points',
    });
  } else {
    if (points.length < MIN_POINTS) {
      issues.push({
        code: 'too-few-points',
        message: `points must have at least ${MIN_POINTS} samples (got ${points.length}).`,
        path: 'points',
      });
    }

    let lastPower = -Infinity;
    const seenPowers = new Set<number>();
    for (let i = 0; i < points.length; i++) {
      const p = points[i] as Record<string, unknown>;
      const cp = typeof p?.commandedPower === 'number' ? p.commandedPower : NaN;
      const od = typeof p?.observedDarkness === 'number' ? p.observedDarkness : NaN;
      if (!Number.isFinite(cp) || cp < 0 || cp > 100) {
        issues.push({
          code: 'point-out-of-range',
          message: `points[${i}].commandedPower must be in [0, 100] (got ${String(p?.commandedPower)}).`,
          path: `points[${i}].commandedPower`,
        });
      }
      if (!Number.isFinite(od) || od < 0 || od > 1) {
        issues.push({
          code: 'point-out-of-range',
          message: `points[${i}].observedDarkness must be in [0, 1] (got ${String(p?.observedDarkness)}).`,
          path: `points[${i}].observedDarkness`,
        });
      }
      if (Number.isFinite(cp)) {
        if (cp < lastPower) {
          issues.push({
            code: 'points-not-sorted',
            message: `points must be sorted by commandedPower ascending; index ${i} (power ${cp}) is below previous (${lastPower}).`,
            path: `points[${i}]`,
          });
        }
        if (seenPowers.has(cp)) {
          issues.push({
            code: 'duplicate-power-point',
            message: `points[${i}].commandedPower duplicates an earlier sample at power ${cp}.`,
            path: `points[${i}].commandedPower`,
          });
        }
        seenPowers.add(cp);
        lastPower = cp;
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

/**
 * Convert a validated `CommunityResponseCurveEnvelope` into the
 * canonical `ResponseCurve` shape used by `darknessToPower` and the
 * profile's per-material curve map. Caller supplies a fresh `id`
 * because the canonical curve carries one but the envelope is
 * shareable across machines and intentionally does not.
 */
export function adoptCommunityResponseCurve(
  envelope: CommunityResponseCurveEnvelope,
  id: string,
): ResponseCurve {
  return {
    id,
    materialName: envelope.materialName,
    calibrationSpeed: envelope.calibrationSpeed,
    points: envelope.points.map((p) => ({
      commandedPower: p.commandedPower,
      observedDarkness: p.observedDarkness,
    })),
    calibratedAt: envelope.calibratedAt,
    note: envelope.note,
  };
}

/**
 * Reverse: export a canonical `ResponseCurve` plus optional
 * machine/contributor attribution to the shareable envelope shape.
 * Used by the in-app "Export curve as JSON" action (a future T3-24
 * UI follow-up slice will surface this).
 */
export function exportCommunityResponseCurve(
  curve: ResponseCurve,
  attribution?: {
    machine?: CommunityResponseCurveEnvelope['machine'];
    contributor?: CommunityResponseCurveEnvelope['contributor'];
  },
): CommunityResponseCurveEnvelope {
  return {
    format: 'laserforge-community-response-curve',
    formatVersion: COMMUNITY_RESPONSE_CURVE_FORMAT_VERSION,
    materialName: curve.materialName,
    calibrationSpeed: curve.calibrationSpeed,
    machine: attribution?.machine,
    contributor: attribution?.contributor,
    calibratedAt: curve.calibratedAt,
    note: curve.note,
    points: curve.points.map((p) => ({
      commandedPower: p.commandedPower,
      observedDarkness: p.observedDarkness,
    })),
  };
}
