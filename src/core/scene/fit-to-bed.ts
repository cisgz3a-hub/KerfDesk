// fitObjectToBed — returns the SceneObject centered on the bed, normally
// scaled to fit `(bedWidth × bedHeight)` with a 10% margin. The explicit
// center-only mode preserves scale for imports whose authored physical size is
// part of their contract.
//
// Math: scale s = 0.9 × min(bedW / w, bedH / h). For objects that already
// fit, s caps at 1 (we don't grow small designs to fill the bed). Translation
// puts the object's center at (bedW/2, bedH/2) in logical scene coords.

import type { SceneObject } from './scene-object';
import { applyTransform } from './transform';

const FIT_MARGIN = 0.9;

export function fitObjectToBed(
  object: SceneObject,
  bedWidth: number,
  bedHeight: number,
  mode: 'fit' | 'center-only' = 'fit',
): SceneObject {
  if (mode === 'center-only') return centerObjectOnBed(object, bedWidth, bedHeight);
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

/** Center an object on the bed while preserving its authored transform scale. */
function centerObjectOnBed(object: SceneObject, bedWidth: number, bedHeight: number): SceneObject {
  const { bounds } = object;
  const w = bounds.maxX - bounds.minX;
  const h = bounds.maxY - bounds.minY;
  if (w <= 0 || h <= 0) return object;
  const localCenter = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const withoutTranslation = { ...object.transform, x: 0, y: 0 };
  const mappedCenter = applyTransform(localCenter, withoutTranslation);
  return {
    ...object,
    transform: {
      ...object.transform,
      x: bedWidth / 2 - mappedCenter.x,
      y: bedHeight / 2 - mappedCenter.y,
    },
  };
}
