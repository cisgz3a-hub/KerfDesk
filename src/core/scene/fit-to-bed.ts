// fitObjectToBed — returns the SceneObject centered on the bed. Art that fits
// the bed keeps its size: like LightBurn, an import arrives at its file size.
// Only a footprint larger than the bed in either axis is scaled down,
// uniformly, to fit (measureBedFit). The explicit center-only mode never
// scales, for imports whose authored physical size must survive even off-bed.
//
// Centering maps the local bounds center through the object's transform and
// translates it to (bedW/2, bedH/2) in logical scene coords; scaling keeps
// that center in place, so a staggered import keeps its offset.

import { transformedBounds } from './hit-test';
import type { Bounds, SceneObject } from './scene-object';
import { applyTransform } from './transform';

// Oversize art has no file size that fits, so it lands inside 90% of the bed
// rather than edge to edge: the outline stays clear of the bed limits, leaving
// room for raster overscan, kerf offsets, Frame and the 10 mm multi-import
// stagger instead of sizing art into an immediate out-of-bounds warning.
const FIT_MARGIN = 0.9;
// Unit conversion and centering can leave bed-sized art a few ulps over the
// bed; that float noise is not oversize art and must not shrink or flag it.
export const BED_FIT_TOLERANCE_MM = 1e-6;

/** An object's footprint against the bed, and the scale that fits it. */
export type BedFit = {
  /** Uniform factor for the object's current scale; 1 when it already fits. */
  readonly scale: number;
  readonly widthMm: number;
  readonly heightMm: number;
  readonly bedWidthMm: number;
  readonly bedHeightMm: number;
};

export function fitObjectToBed(
  object: SceneObject,
  bedWidth: number,
  bedHeight: number,
  mode: 'fit' | 'center-only' = 'fit',
): SceneObject {
  const centered = centerObjectOnBed(object, bedWidth, bedHeight);
  if (mode === 'center-only') return centered;
  return scaleObjectAboutCenter(centered, measureBedFit(centered, bedWidth, bedHeight).scale);
}

/** Measure the object's scaled, rotated footprint; translation is ignored. */
export function measureBedFit(object: SceneObject, bedWidth: number, bedHeight: number): BedFit {
  const footprint = transformedBounds(object.bounds, { ...object.transform, x: 0, y: 0 });
  return measureBoundsBedFit(footprint, bedWidth, bedHeight);
}

/** Measure a whole selection without fitting its components independently. */
export function measureBoundsBedFit(
  footprint: Bounds,
  bedWidth: number,
  bedHeight: number,
): BedFit {
  const widthMm = footprint.maxX - footprint.minX;
  const heightMm = footprint.maxY - footprint.minY;
  const fits =
    widthMm <= 0 ||
    heightMm <= 0 ||
    (widthMm <= bedWidth + BED_FIT_TOLERANCE_MM && heightMm <= bedHeight + BED_FIT_TOLERANCE_MM);
  return {
    scale: fits ? 1 : FIT_MARGIN * Math.min(bedWidth / widthMm, bedHeight / heightMm),
    widthMm,
    heightMm,
    bedWidthMm: bedWidth,
    bedHeightMm: bedHeight,
  };
}

/** Multiply both scale axes by `factor`, keeping the bounds center in place. */
export function scaleObjectAboutCenter(object: SceneObject, factor: number): SceneObject {
  if (factor === 1) return object;
  const localCenter = boundsCenter(object);
  const before = applyTransform(localCenter, object.transform);
  const scaled = {
    ...object.transform,
    scaleX: object.transform.scaleX * factor,
    scaleY: object.transform.scaleY * factor,
  };
  const after = applyTransform(localCenter, scaled);
  return {
    ...object,
    transform: { ...scaled, x: scaled.x + before.x - after.x, y: scaled.y + before.y - after.y },
  };
}

/** Center an object on the bed while preserving its authored transform scale. */
function centerObjectOnBed(object: SceneObject, bedWidth: number, bedHeight: number): SceneObject {
  const { bounds } = object;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0) return object;
  const withoutTranslation = { ...object.transform, x: 0, y: 0 };
  const mappedCenter = applyTransform(boundsCenter(object), withoutTranslation);
  return {
    ...object,
    transform: {
      ...object.transform,
      x: bedWidth / 2 - mappedCenter.x,
      y: bedHeight / 2 - mappedCenter.y,
    },
  };
}

function boundsCenter({ bounds }: SceneObject): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
