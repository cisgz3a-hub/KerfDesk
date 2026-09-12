import type { CncTileRegistration } from '../../core/scene/machine';

/** Preserve valid requested values and unknown tool identities exactly. Cutter
 * applicability is resolved when producing the bore, never by replacing it. */
export function normalizeTileRegistration(
  raw: unknown,
): { registration: CncTileRegistration } | Record<string, never> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  if (typeof value['toolId'] !== 'string') return {};
  const numericKeys = [
    'holeDiameterMm',
    'depthMm',
    'depthPerPassMm',
    'feedMmPerMin',
    'plungeMmPerMin',
    'spindleRpm',
  ] as const;
  for (const key of numericKeys) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] <= 0)
      return {};
  }
  return {
    registration: {
      toolId: value['toolId'],
      holeDiameterMm: value['holeDiameterMm'] as number,
      depthMm: value['depthMm'] as number,
      depthPerPassMm: value['depthPerPassMm'] as number,
      feedMmPerMin: value['feedMmPerMin'] as number,
      plungeMmPerMin: value['plungeMmPerMin'] as number,
      spindleRpm: value['spindleRpm'] as number,
    },
  };
}
