// fitObjectToRegion — returns the SceneObject with its transform set so the
// object fits inside a target region (any rectangle in scene mm) and is centered
// in it. Generalizes fitObjectToBed (which fits the whole bed with a fixed 10%
// margin and never grows small designs): here the region and margin are
// caller-supplied, and `grow` decides whether a design smaller than the region
// is scaled UP to fill it. "Fit artwork to the placed board" wants grow=true;
// the bed-import path wants grow=false.
//
// Fit uses the object's ROTATED footprint (the AABB of its transform at unit
// scale), NOT its intrinsic W×H — otherwise a rotated design overflows the
// region and burns off the physical board. Because a uniform scale s is applied
// before rotation, the footprint scales linearly with s, so
// s = margin·min(regionW/footprintW, regionH/footprintH) fits it exactly.
// Centering is rotation-safe too: the local center is mapped through the scaled
// transform and the offset placed so that point lands on the region center.

import { transformedBounds } from './hit-test';
import type { Bounds, SceneObject } from './scene-object';
import { applyTransform } from './transform';

export type FitToRegionOptions = {
  // Fraction of the region the fit fills; 0.9 leaves a 10% margin.
  readonly marginFraction: number;
  // Scale a design smaller than the region UP to fill it?
  readonly grow: boolean;
};

export function fitObjectToRegion(
  object: SceneObject,
  region: Bounds,
  options: FitToRegionOptions,
): SceneObject {
  const regionW = region.maxX - region.minX;
  const regionH = region.maxY - region.minY;
  if (regionW <= 0 || regionH <= 0) return object;

  // The design's footprint at unit scale, keeping its rotation/mirror.
  const footprint = transformedBounds(object.bounds, {
    ...object.transform,
    scaleX: 1,
    scaleY: 1,
    x: 0,
    y: 0,
  });
  const w = footprint.maxX - footprint.minX;
  const h = footprint.maxY - footprint.minY;
  if (w <= 0 || h <= 0) return object;

  const fitted = options.marginFraction * Math.min(regionW / w, regionH / h);
  const scale = options.grow ? fitted : Math.min(1, fitted);

  // Map the local center through the new scale/rotation/mirror with no offset,
  // then translate so it lands on the region center.
  const localCenter = {
    x: (object.bounds.minX + object.bounds.maxX) / 2,
    y: (object.bounds.minY + object.bounds.maxY) / 2,
  };
  const scaledTransform = { ...object.transform, scaleX: scale, scaleY: scale, x: 0, y: 0 };
  const mapped = applyTransform(localCenter, scaledTransform);

  return {
    ...object,
    transform: {
      ...scaledTransform,
      x: (region.minX + region.maxX) / 2 - mapped.x,
      y: (region.minY + region.maxY) / 2 - mapped.y,
    },
  };
}
