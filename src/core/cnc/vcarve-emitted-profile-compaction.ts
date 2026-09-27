import type { Vec3 } from '../geometry/vec3';
import {
  asVCarveBoundarySegmentIndex,
  type VCarveBoundarySegmentIndex,
  type VCarveBoundarySegmentSource,
} from './vcarve-boundary-segment-index';
import { emittedChordClearanceIsSafe } from './vcarve-detail-chord-safety';
import { vcarveEmittedSpanFitsChord } from './vcarve-emitted-profile-single-chord';
import {
  pointInsideVCarveBoundary,
  type VCarveCertifiedEnvelope,
} from './vcarve-cutting-constraints';

const MAX_COMPACTION_SPAN_POINTS = 32;

/** Remove emitted microsegments only when one safe chord preserves their swept cone. */
export function compactVCarveEmittedProfile(
  points: ReadonlyArray<Vec3>,
  segments: VCarveBoundarySegmentSource,
  envelope: VCarveCertifiedEnvelope,
  toleranceMm: number,
): ReadonlyArray<Vec3> {
  if (points.length < 3) return points;
  const boundary = asVCarveBoundarySegmentIndex(segments);
  // The span search repeatedly checks the same endpoints. Membership
  // depends only on that emitted endpoint and this boundary, so certify it
  // once for this synchronous compaction call. Chord clearance and swept
  // coverage are still checked separately for every proposed span.
  const cuttingPointInside = cuttingPointMembership(points, boundary, envelope);
  const compact: Vec3[] = [];
  let start = 0;
  while (start < points.length - 1) {
    const a = points[start];
    if (a === undefined) break;
    compact.push(a);
    const maximumEnd = maximumCompactionEnd(points, start);
    let chosenEnd = start + 1;
    for (let end = maximumEnd; end > start + 1; end -= 1) {
      const b = points[end];
      if (
        b !== undefined &&
        cuttingPointInside?.[start] !== false &&
        cuttingPointInside?.[end] !== false &&
        spanCanCompact(points, start, end, a, b, boundary, envelope, toleranceMm)
      ) {
        chosenEnd = end;
        break;
      }
    }
    start = chosenEnd;
  }
  const last = points.at(-1);
  if (last !== undefined) compact.push(last);
  return compact;
}

function cuttingPointMembership(
  points: ReadonlyArray<Vec3>,
  boundary: VCarveBoundarySegmentIndex,
  envelope: VCarveCertifiedEnvelope,
): ReadonlyArray<boolean> | undefined {
  if (!envelope.requireInsideBoundary) return undefined;
  return points.map((point) => !(point.z < 0) || pointInsideVCarveBoundary(point, boundary));
}

function maximumCompactionEnd(points: ReadonlyArray<Vec3>, start: number): number {
  const maximumEnd = Math.min(points.length - 1, start + MAX_COMPACTION_SPAN_POINTS);
  for (let index = start + 1; index < maximumEnd; index += 1) {
    // A footprint allowance can cover a complete shallow corner excursion
    // without actually reaching its cutting/surface transition. Keep those
    // shared surface endpoints so compaction cannot leave an uncut corner.
    if (
      points[index]?.z === 0 &&
      ((points[index - 1]?.z ?? 0) < 0 || (points[index + 1]?.z ?? 0) < 0)
    ) {
      return index;
    }
  }
  return maximumEnd;
}

function spanCanCompact(
  points: ReadonlyArray<Vec3>,
  start: number,
  end: number,
  a: Vec3,
  b: Vec3,
  boundary: VCarveBoundarySegmentIndex,
  envelope: VCarveCertifiedEnvelope,
  toleranceMm: number,
): boolean {
  if (
    !emittedChordClearanceIsSafe(a, b, Math.max(0, -a.z), Math.max(0, -b.z), boundary, envelope)
  ) {
    return false;
  }
  return vcarveEmittedSpanFitsChord(points, start, end, a, b, envelope, toleranceMm);
}
