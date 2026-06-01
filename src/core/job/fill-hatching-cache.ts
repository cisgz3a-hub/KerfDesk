import type { Layer, Polyline } from '../scene';
import { fillHatching } from './fill-hatching';

const MAX_SETTINGS_PER_POLYLINE_SET = 8;

const hatchCache = new WeakMap<ReadonlyArray<Polyline>, Map<string, ReadonlyArray<Polyline>>>();

export function memoizedFillHatching(
  polylines: ReadonlyArray<Polyline>,
  layer: Pick<Layer, 'hatchAngleDeg' | 'hatchSpacingMm'>,
): ReadonlyArray<Polyline> {
  const cacheKey = `${layer.hatchAngleDeg}:${layer.hatchSpacingMm}`;
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
  });
  if (bySettings.size >= MAX_SETTINGS_PER_POLYLINE_SET) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, hatches);
  return hatches;
}
