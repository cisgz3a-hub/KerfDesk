import { combinedBBox } from './hit-test';
import type { Bounds, SceneObject } from './scene-object';
import type { FitToRegionOptions } from './fit-to-region';

const MIN_FIT_DIMENSION_MM = 0.000001;

/** Proportionally fits a selection as one layout while preserving its internal spacing. */
export function fitSelectionToRegion(
  objects: ReadonlyArray<SceneObject>,
  region: Bounds,
  options: FitToRegionOptions,
): ReadonlyArray<SceneObject> {
  const bounds = combinedBBox(objects);
  if (bounds === null) return objects;
  const selectionWidth = bounds.maxX - bounds.minX;
  const selectionHeight = bounds.maxY - bounds.minY;
  const regionWidth = region.maxX - region.minX;
  const regionHeight = region.maxY - region.minY;
  if (
    selectionWidth <= MIN_FIT_DIMENSION_MM ||
    selectionHeight <= MIN_FIT_DIMENSION_MM ||
    regionWidth <= MIN_FIT_DIMENSION_MM ||
    regionHeight <= MIN_FIT_DIMENSION_MM
  ) {
    return objects;
  }

  const fittedScale =
    options.marginFraction * Math.min(regionWidth / selectionWidth, regionHeight / selectionHeight);
  const scale = options.grow ? fittedScale : Math.min(1, fittedScale);
  const sourceCenter = centerOf(bounds);
  const targetCenter = centerOf(region);
  return objects.map((object) => ({
    ...object,
    transform: {
      ...object.transform,
      x: targetCenter.x + (object.transform.x - sourceCenter.x) * scale,
      y: targetCenter.y + (object.transform.y - sourceCenter.y) * scale,
      scaleX: object.transform.scaleX * scale,
      scaleY: object.transform.scaleY * scale,
    },
  }));
}

function centerOf(bounds: Bounds): { readonly x: number; readonly y: number } {
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
