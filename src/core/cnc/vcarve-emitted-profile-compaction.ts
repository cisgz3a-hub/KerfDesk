import type { Vec3 } from '../geometry/vec3';
import {
  asVCarveBoundarySegmentIndex,
  type VCarveBoundarySegmentIndex,
  type VCarveBoundarySegmentSource,
} from './vcarve-boundary-segment-index';
import { emittedChordIsSafe } from './vcarve-detail-depth';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';
import type { RadialEnvelope } from './radial-envelope';

const MAX_COMPACTION_SPAN_POINTS = 32;

/** Remove emitted microsegments only when one safe chord preserves their swept cone. */
export function compactVCarveEmittedProfile(
  points: ReadonlyArray<Vec3>,
  segments: VCarveBoundarySegmentSource,
  envelope: RadialEnvelope,
  toleranceMm: number,
): ReadonlyArray<Vec3> {
  if (points.length < 3) return points;
  const boundary = asVCarveBoundarySegmentIndex(segments);
  const compact: Vec3[] = [];
  let start = 0;
  while (start < points.length - 1) {
    const a = points[start];
    if (a === undefined) break;
    compact.push(a);
    const maximumEnd = Math.min(points.length - 1, start + MAX_COMPACTION_SPAN_POINTS);
    let chosenEnd = start + 1;
    for (let end = maximumEnd; end > start + 1; end -= 1) {
      const b = points[end];
      if (
        b !== undefined &&
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

function spanCanCompact(
  points: ReadonlyArray<Vec3>,
  start: number,
  end: number,
  a: Vec3,
  b: Vec3,
  boundary: VCarveBoundarySegmentIndex,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  if (!emittedChordIsSafe(a, b, Math.max(0, -a.z), Math.max(0, -b.z), boundary, envelope)) {
    return false;
  }
  return vcarveEmittedProfileCovers(points.slice(start, end + 1), [a, b], envelope, toleranceMm);
}
