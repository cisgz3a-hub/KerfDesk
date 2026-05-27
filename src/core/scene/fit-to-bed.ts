// fitObjectToBed — returns the SceneObject with its transform set so the
// object fits inside `(bedWidth × bedHeight)` (with a 10% margin) and is
// centered on the bed. Used by the import flow so dragging in a big SVG
// doesn't dump a 1m-wide drawing into the corner of a 400 mm bed.
//
// Math: scale s = 0.9 × min(bedW / w, bedH / h). For objects that already
// fit, s caps at 1 (we don't grow small designs to fill the bed). Translation
// puts the object's center at (bedW/2, bedH/2) in logical scene coords.

import type { SceneObject } from './scene-object';

const FIT_MARGIN = 0.9;

export function fitObjectToBed(
  object: SceneObject,
  bedWidth: number,
  bedHeight: number,
): SceneObject {
  const { bounds } = object;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0) return object;
  const scale = Math.min(1, FIT_MARGIN * Math.min(bedWidth / w, bedHeight / h));
  // Center the scaled bounds on the bed.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return {
    ...object,
    transform: {
      ...object.transform,
      scaleX: scale,
      scaleY: scale,
      x: bedWidth / 2 - scale * cx,
      y: bedHeight / 2 - scale * cy,
    },
  };
}
