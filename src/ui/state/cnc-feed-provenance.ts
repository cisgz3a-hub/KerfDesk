import type { CncLayerSettings } from '../../core/scene';

const SOURCE_INVALIDATING_KEYS: ReadonlySet<keyof CncLayerSettings> = new Set([
  'toolId',
  'depthPerPassMm',
  'feedMmPerMin',
  'plungeMmPerMin',
  'spindleRpm',
]);

/** A hand edit of a cutting value makes the operation manual: it drops the
 * automatic provenance and the material label those numbers no longer follow
 * (ADR-233 decision 5). An unchanged value changes nothing. */
export function withManualCncFeedPatch(
  settings: CncLayerSettings,
  patch: Partial<CncLayerSettings>,
): CncLayerSettings {
  const next = { ...settings, ...patch };
  const edited = (Object.keys(patch) as Array<keyof CncLayerSettings>).some(
    (key) => SOURCE_INVALIDATING_KEYS.has(key) && next[key] !== settings[key],
  );
  return edited ? withoutCncFeedProvenance(next) : next;
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

/** The material an operation's values follow: its label, or a legacy recipe's. */
export function cncOperationMaterialKey(settings: CncLayerSettings): string | undefined {
  return (
    settings.materialKey ??
    (settings.feedSource?.kind === 'material-recipe' ? settings.feedSource.materialKey : undefined)
  );
}
