import type { Vec2 } from '../scene';
import {
  EMIT_COORDINATE_QUANTUM_MM,
  emittedPoint,
  pointToSegmentDistance,
  type BoundarySegment,
} from './vcarve-detail-geometry';
import { vcarveEmittedDepthAtPoint, type DetailDepthLaw } from './vcarve-detail-depth';

/** True only when fixed 0.001 mm emission can retain every route-node radius. */
export function vcarveRoutePrecisionMet(
  points: ReadonlyArray<Vec2>,
  segments: ReadonlyArray<BoundarySegment>,
  law: DetailDepthLaw,
  sweepToleranceMm: number,
): boolean {
  const radiusCapMm = law.maxDepthMm * law.tanHalf;
  return points.every((rawPoint) => {
    const point = emittedPoint(rawPoint);
    let exactRadiusMm = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      exactRadiusMm = Math.min(exactRadiusMm, pointToSegmentDistance(point.x, point.y, segment));
    }
    exactRadiusMm = Math.min(exactRadiusMm, radiusCapMm);
    const emittedRadiusMm = vcarveEmittedDepthAtPoint(point, segments, law) * law.tanHalf;
    return exactRadiusMm - emittedRadiusMm <= sweepToleranceMm + EMIT_COORDINATE_QUANTUM_MM * 1e-9;
  });
}
