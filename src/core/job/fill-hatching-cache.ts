import type { Layer, Polyline } from '../scene';
import { fillHatchingWithMetadata, type HatchFillRule, type HatchPolyline } from './fill-hatching';

const MAX_SETTINGS_PER_POLYLINE_SET = 8;

// Allowed module-level cache (narrow exception to "no module-level mutable") —
// see ADR-050. Identity-keyed via WeakMap (GC-bounded), output-invariant (the
// key below holds every setting that affects geometry), inner map capped at
// MAX_SETTINGS_PER_POLYLINE_SET, behavior pinned by compile-job-fill-cache.test.ts.
const hatchCache = new WeakMap<
  ReadonlyArray<Polyline>,
  Map<string, ReadonlyArray<HatchPolyline>>
>();

export function memoizedFillHatching(
  polylines: ReadonlyArray<Polyline>,
  layer: Pick<Layer, 'hatchAngleDeg' | 'hatchSpacingMm' | 'fillBidirectional' | 'fillCrossHatch'>,
  fillRule: HatchFillRule = 'evenodd',
): ReadonlyArray<Polyline> {
  return memoizedFillHatchingWithMetadata(polylines, layer, fillRule).map(stripHatchMetadata);
}

export function memoizedFillHatchingWithMetadata(
  polylines: ReadonlyArray<Polyline>,
  layer: Pick<Layer, 'hatchAngleDeg' | 'hatchSpacingMm' | 'fillBidirectional' | 'fillCrossHatch'>,
  fillRule: HatchFillRule = 'evenodd',
): ReadonlyArray<HatchPolyline> {
  // fillBidirectional is part of the key: toggling snake/unidirectional changes
  // the hatch geometry, so a stale cache entry would silently keep the old path.
  const cacheKey = `${layer.hatchAngleDeg}:${layer.hatchSpacingMm}:${layer.fillBidirectional}:${layer.fillCrossHatch}:${fillRule}`;
  let bySettings = hatchCache.get(polylines);
  if (bySettings === undefined) {
    bySettings = new Map<string, ReadonlyArray<HatchPolyline>>();
    hatchCache.set(polylines, bySettings);
  }

  const cached = bySettings.get(cacheKey);
  if (cached !== undefined) return cached;

  const hatches = fillHatchingWithMetadata({
    polylines,
    hatchAngleDeg: layer.hatchAngleDeg,
    hatchSpacingMm: layer.hatchSpacingMm,
    fillRule,
    bidirectional: layer.fillBidirectional,
  });
  const crossHatches = layer.fillCrossHatch
    ? fillHatchingWithMetadata({
        polylines,
        hatchAngleDeg: layer.hatchAngleDeg + 90,
        hatchSpacingMm: layer.hatchSpacingMm,
        fillRule,
        bidirectional: layer.fillBidirectional,
      })
    : [];
  const output = layer.fillCrossHatch ? [...hatches, ...crossHatches] : hatches;
  if (bySettings.size >= MAX_SETTINGS_PER_POLYLINE_SET) {
    const oldestKey = bySettings.keys().next().value;
    if (oldestKey !== undefined) bySettings.delete(oldestKey);
  }
  bySettings.set(cacheKey, output);
  return output;
}

function stripHatchMetadata(pl: HatchPolyline): Polyline {
  return { points: pl.points, closed: pl.closed };
}
