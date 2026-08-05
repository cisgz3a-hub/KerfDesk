import type { Vec2 } from '../scene';
import {
  asVCarveBoundarySegmentIndex,
  minimumVCarveBoundaryPointDistance,
  type VCarveBoundarySegmentSource,
} from './vcarve-boundary-segment-index';
import { EMIT_COORDINATE_QUANTUM_MM, emittedPoint } from './vcarve-detail-geometry';
import { vcarveEmittedDepthAtPoint, type DetailDepthLaw } from './vcarve-detail-depth';
import {
  radialEnvelopeDepthMm,
  radialEnvelopeFootprintMm,
  radialEnvelopeRemovalRadiusMm,
} from './radial-envelope';

/** True only when fixed 0.001 mm emission can retain every route-node radius. */
export function vcarveRoutePrecisionMet(
  points: ReadonlyArray<Vec2>,
  segments: VCarveBoundarySegmentSource,
  law: DetailDepthLaw,
  sweepToleranceMm: number,
): boolean {
  const radiusCapMm = radialEnvelopeFootprintMm(law, law.maxDepthMm);
  const boundary = asVCarveBoundarySegmentIndex(segments);
  return points.every((rawPoint) => {
    const point = emittedPoint(rawPoint);
    const clearanceMm = minimumVCarveBoundaryPointDistance(boundary, point);
    const emittedDepthMm = vcarveEmittedDepthAtPoint(point, boundary, law);
    // Preserve the exact pointed-bit arithmetic that owns existing emitted
    // profile compaction and snapshots. The flat-tip branch needs the inverse
    // law so sub-tip clearance has a zero target rather than a phantom disk.
    const exactRadiusMm =
      law.tipRadiusMm === 0
        ? Math.min(clearanceMm, radiusCapMm)
        : exactFlatTipRadiusMm(law, clearanceMm, radiusCapMm);
    const emittedRadiusMm =
      law.tipRadiusMm === 0
        ? emittedDepthMm * law.tanHalf
        : radialEnvelopeRemovalRadiusMm(law, emittedDepthMm);
    return exactRadiusMm - emittedRadiusMm <= sweepToleranceMm + EMIT_COORDINATE_QUANTUM_MM * 1e-9;
  });
}

function exactFlatTipRadiusMm(
  law: DetailDepthLaw,
  clearanceMm: number,
  radiusCapMm: number,
): number {
  const exactDepthMm = Math.min(radialEnvelopeDepthMm(law, clearanceMm), law.maxDepthMm);
  return exactDepthMm > 0 ? Math.min(radialEnvelopeFootprintMm(law, exactDepthMm), radiusCapMm) : 0;
}
