import type { Layer, Polyline } from '../scene';
import { fillHatching } from './fill-hatching';

const MAX_SETTINGS_PER_POLYLINE_SET = 8;

const hatchCache = new WeakMap<ReadonlyArray<Polyline>, Map<string, ReadonlyArray<Polyline>>>();

export function memoizedFillHatching(
  polylines: ReadonlyArray<Polyline>,
  layer: Pick<Layer, 'hatchAngleDeg' | 'hatchSpacingMm' | 'fillBidirectional'>,
): ReadonlyArray<Polyline> {
  // fillBidirectional is part of the key: toggling snake/unidirectional changes
  // the hatch geometry, so a stale cache entry would silently keep the old path.
  const cacheKey = `${layer.hatchAngleDeg}:${layer.hatchSpacingMm}:${layer.fillBidirectional}`;
  let bySettings = hatchCache.get(polylines);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<Polyline>>();
    hatchCache.set(polylines, bySettings);
  }

  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const hatches = fillHatching({
    polylines,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
    bidirectional: layer.fillBidirectional,
  });
  if (bySettings.size >= MAX_SETTINGS_PER_POLYLINE_SET) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}
