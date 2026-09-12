import type { Vec2 } from '../scene';
import {
  asVCarveBoundarySegmentIndex,
  everyVCarveBoundarySegmentInBox,
  type VCarveBoundarySegmentSource,
} from './vcarve-boundary-segment-index';
import { CNC_COORDINATE_QUANTUM_MM } from './cnc-output-precision';
import type { RadialEnvelope } from './radial-envelope';

/** Certificate constraints, separate from the cutter's physical radial envelope. */
export type VCarveCuttingConstraints = {
  readonly boundaryClearanceMm?: number;
  readonly requireInsideBoundary?: boolean;
};

export type VCarveCertifiedEnvelope = RadialEnvelope & VCarveCuttingConstraints;

/** Keep the certificate valid after origin placement and tile clipping. */
export function vcarveEmissionConstraints(envelope: RadialEnvelope): VCarveCuttingConstraints {
  // A final rounded endpoint moves at most sqrt(2) * q / 2 in XY; a chord
  // inherits that endpoint displacement bound. Rigid placement and exact
  // clipping add no error. V-carve depth levels and clipped Z endpoints use
  // vcarveConservativeZ, so final formatting cannot enlarge the cutter radius.
  // The tiny slope-dependent slack also covers its grid arithmetic tolerance.
  return {
    boundaryClearanceMm:
      (Math.SQRT2 * CNC_COORDINATE_QUANTUM_MM) / 2 + 1e-9 + envelope.tanHalf * 1e-12,
    requireInsideBoundary: true,
  };
}

/** Represent cutting Z toward the surface; do not deepen a newly split chord. */
export function vcarveConservativeZ(z: number): number {
  return Math.min(
    0,
    Math.ceil((z - 1e-12) / CNC_COORDINATE_QUANTUM_MM) * CNC_COORDINATE_QUANTUM_MM,
  );
}

/** Even-odd membership of the original normalized closed region. */
export function pointInsideVCarveBoundary(
  point: Vec2,
  segments: VCarveBoundarySegmentSource,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  const boundary = asVCarveBoundarySegmentIndex(segments);
  let inside = false;
  everyVCarveBoundarySegmentInBox(
    boundary,
    {
      minX: point.x,
      minY: point.y,
      maxX: boundary.root?.maxX ?? Number.POSITIVE_INFINITY,
      maxY: point.y,
    },
    (segment) => {
      if (
        segment.ay > point.y !== segment.by > point.y &&
        point.x <
          segment.ax +
            ((point.y - segment.ay) * (segment.bx - segment.ax)) / (segment.by - segment.ay)
      ) {
        inside = !inside;
      }
      return true;
    },
  );
  return inside;
}
