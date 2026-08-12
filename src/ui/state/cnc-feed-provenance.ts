import type { CncLayerSettings } from '../../core/scene';

const SOURCE_INVALIDATING_KEYS: ReadonlySet<keyof CncLayerSettings> = new Set([
  'toolId',
  'depthPerPassMm',
  'feedMmPerMin',
  'plungeMmPerMin',
  'spindleRpm',
]);

export function withManualCncFeedPatch(
  settings: CncLayerSettings,
  patch: Partial<CncLayerSettings>,
): CncLayerSettings {
  const next = { ...settings, ...patch };
  if (
    !Object.keys(patch).some((key) => SOURCE_INVALIDATING_KEYS.has(key as keyof CncLayerSettings))
  ) {
    return next;
  }
  return withoutCncFeedSource(next);
}

/** Withdraws automatic numeric provenance without changing the Startup material binding. */
export function withoutCncFeedSource(settings: CncLayerSettings): CncLayerSettings {
  const { feedSource: _source, ...manual } = settings;
  return manual;
}

export function withoutCncFeedProvenance(settings: CncLayerSettings): CncLayerSettings {
  const { materialKey: _material, ...manual } = withoutCncFeedSource(settings);
  return manual;
}
