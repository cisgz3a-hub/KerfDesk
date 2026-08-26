import type { CncSubProfile } from './device-profile';

export type CncSubProfileValidation = {
  readonly value: CncSubProfile | undefined;
  readonly issues: ReadonlyArray<string>;
};

const COOLANT_MODES = ['off', 'mist', 'flood'] as const;

/** Validate the persisted machine-wide CNC fields before they reach setup or output. */
export function cncSubProfileIssues(value: unknown, path = 'cncSubProfile'): ReadonlyArray<string> {
  if (value === undefined) return [];
  if (!isRecord(value)) return [`${path} must be an object`];
  const issues: string[] = [];
  if (!isPositiveFinite(value['safeZMm'])) issues.push(`${path}.safeZMm must be positive`);
  if (!isPositiveFinite(value['spindleMaxRpm'])) {
    issues.push(`${path}.spindleMaxRpm must be positive`);
  }
  if (!isNonNegativeFinite(value['spindleSpinupSec'])) {
    issues.push(`${path}.spindleSpinupSec must be non-negative`);
  }
  if (value['coolant'] !== undefined && !COOLANT_MODES.includes(value['coolant'] as never)) {
    issues.push(`${path}.coolant must be off, mist, or flood`);
  }
  for (const field of ['parkXMm', 'parkYMm'] as const) {
    if (value[field] !== undefined && !isFiniteNumber(value[field])) {
      issues.push(`${path}.${field} must be finite`);
    }
  }
  return issues;
}

/**
 * Field-wise recovery for an imported or persisted profile. Every repair is
 * returned as an issue so callers can disclose it; invalid optional park
 * coordinates are omitted instead of being allowed to reach numeric output.
 */
export function recoverCncSubProfile(
  value: unknown,
  fallback: CncSubProfile,
  path = 'cncSubProfile',
): CncSubProfileValidation {
  if (value === undefined) return { value: undefined, issues: [] };
  const issues = cncSubProfileIssues(value, path);
  if (!isRecord(value)) return { value: { ...fallback }, issues };
  const coolant = COOLANT_MODES.includes(value['coolant'] as never)
    ? (value['coolant'] as NonNullable<CncSubProfile['coolant']>)
    : fallback.coolant;
  return {
    value: {
      safeZMm: isPositiveFinite(value['safeZMm']) ? value['safeZMm'] : fallback.safeZMm,
      spindleMaxRpm: isPositiveFinite(value['spindleMaxRpm'])
        ? value['spindleMaxRpm']
        : fallback.spindleMaxRpm,
      spindleSpinupSec: isNonNegativeFinite(value['spindleSpinupSec'])
        ? value['spindleSpinupSec']
        : fallback.spindleSpinupSec,
      ...(coolant === undefined ? {} : { coolant }),
      ...(isFiniteNumber(value['parkXMm']) ? { parkXMm: value['parkXMm'] } : {}),
      ...(isFiniteNumber(value['parkYMm']) ? { parkYMm: value['parkYMm'] } : {}),
    },
    issues,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}
