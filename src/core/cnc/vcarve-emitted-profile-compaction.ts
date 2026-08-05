import type { Vec3 } from '../geometry/vec3';
import type { VCarveBoundaryIndex } from './vcarve-boundary-index';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { emittedChordIsSafe } from './vcarve-detail-depth';
import { vcarveEmittedChordCoversProfileSpan } from './vcarve-emitted-chord-coverage';
import type { RadialEnvelope } from './radial-envelope';

const MAX_COMPACTION_SPAN_POINTS = 32;

/** Remove emitted microsegments only when one safe chord preserves their swept cone. */
export function compactVCarveEmittedProfile(
  points: ReadonlyArray<Vec3>,
  segments: ReadonlyArray<BoundarySegment>,
  envelope: RadialEnvelope,
  toleranceMm: number,
  boundaryIndex?: VCarveBoundaryIndex,
): ReadonlyArray<Vec3> {
  if (points.length < 3) return points;
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
        spanCanCompact(points, start, end, a, b, segments, envelope, toleranceMm, boundaryIndex)
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
  segments: ReadonlyArray<BoundarySegment>,
  envelope: RadialEnvelope,
  toleranceMm: number,
  boundaryIndex?: VCarveBoundaryIndex,
): boolean {
  if (
    !emittedChordIsSafe(
      a,
      b,
      Math.max(0, -a.z),
      Math.max(0, -b.z),
      segments,
      envelope,
      boundaryIndex,
    )
  ) {
    return false;
  }
  return vcarveEmittedChordCoversProfileSpan(points, start, end, a, b, envelope, toleranceMm);
}
