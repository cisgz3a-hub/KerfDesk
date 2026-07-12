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
  return Math.round((safePercent / 100) * maxPowerS);
}
