import type { Polyline } from '../scene';
import type { BoundarySegment } from './vcarve-detail-geometry';

export function sourceBoundarySegments(
  contours: ReadonlyArray<Polyline>,
): ReadonlyArray<BoundarySegment> {
  const segments: BoundarySegment[] = [];
  for (const contour of contours) {
    for (let index = 0; index < contour.points.length; index += 1) {
      const a = contour.points[index];
      const b = contour.points[(index + 1) % contour.points.length];
      if (a !== undefined && b !== undefined) {
        segments.push({ ax: a.x, ay: a.y, bx: b.x, by: b.y });
      }
    }
  }
  return segments;
}
