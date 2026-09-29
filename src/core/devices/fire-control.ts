export const HARD_MAX_FIRE_POWER_PERCENT = 5;
export const DEFAULT_FIRE_POWER_PERCENT = 1;

export type LaserFireControl = {
  readonly enabled: boolean;
  readonly maxPowerPercent: number;
};

export function normalizeLaserFireControl(value: unknown): LaserFireControl | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const maxPowerPercent = raw['maxPowerPercent'];
  if (
    typeof raw['enabled'] !== 'boolean' ||
    typeof maxPowerPercent !== 'number' ||
    !Number.isFinite(maxPowerPercent) ||
    maxPowerPercent <= 0 ||
    maxPowerPercent > HARD_MAX_FIRE_POWER_PERCENT
  ) {
    return undefined;
  }
  return { enabled: raw['enabled'], maxPowerPercent };
}

/** S for a Fire request, never above the capped share of `maxPowerS`: rounding
 * down keeps the "absolute 5%" ceiling (ADR-162) true on a small S range, where
 * rounding up turned 5% of S255 into S13 (5.1%; controller audit P-2,
 * ADR-375). The epsilon absorbs binary float error so an exact share such as
 * 0.57% of S10000 still yields S57, not S56. */
export function cappedFirePowerS(
  requestedPercent: number,
  control: LaserFireControl,
  maxPowerS: number,
): number {
  const safePercent = Math.min(
    Math.max(0, requestedPercent),
    control.maxPowerPercent,
    HARD_MAX_FIRE_POWER_PERCENT,
  );
  return Math.floor((safePercent * maxPowerS) / 100 + FLOAT_SHARE_EPSILON);
}

const FLOAT_SHARE_EPSILON = 1e-9;
