// boardFitRegion — the AABB that Fit / Array should fill for a captured board
// (ADR-126). For a rectangle it is the box's full scene-space bounds; for a
// circle (an ellipse box) it is the centered INSCRIBED SQUARE (side = d/√2) so
// artwork stays inside the arc rather than overflowing at the corners of the
// bounding square. Pure — no DOM, no I/O.

import { transformedBBox } from './hit-test';
import type { Bounds, ShapeObject } from './scene-object';

export function boardFitRegion(box: ShapeObject): Bounds {
  const bbox = transformedBBox(box);
  if (box.spec.kind !== 'ellipse') return bbox;
  // The largest axis-aligned square inside a circle of diameter d has side d/√2.
  const diameter = Math.min(bbox.maxX - bbox.minX, bbox.maxY - bbox.minY);
  const half = diameter / Math.SQRT2 / 2;
  const cx = (bbox.minX + bbox.maxX) / 2;
  const cy = (bbox.minY + bbox.maxY) / 2;
  return { minX: cx - half, minY: cy - half, maxX: cx + half, maxY: cy + half };
}
