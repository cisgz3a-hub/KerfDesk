// Finishing path shaping (ADR-421). Two changes to the sampled finishing
// motion, neither of which ever moves the tool lower than the planned tip
// surface:
//
// - Stay-down links. Consecutive serpentine rows are joined along the edge
//   column they share, through that column's own sampled tip heights, so the
//   bit rides the surface from one row to the next instead of retracting to
//   safe Z and plunging again. A link is a short column of exact tip samples
//   (the dilation computes both edge columns exactly), so it carries the same
//   qualification as a row.
// - One-sided point reduction. A vertex is dropped only when the straight
//   segment replacing it runs over the same XY and stays at or above every
//   dropped vertex, by no more than the tolerance. Both the old and new motion
//   are linear between their vertices, so the new motion is at or above the
//   old one at every point of the same XY path: whatever the old path cleared,
//   the reduced one clears too.

export type FinishingPoint = { readonly x: number; readonly y: number; readonly z: number };

// Extra stock a dropped vertex may leave under the new straight segment.
export const FINISHING_REDUCTION_TOLERANCE_MM = 0.002;
// Rows share one exact Y and links one exact X, so collinear samples differ
// from the line only by floating-point noise.
const COLLINEAR_MM = 1e-9;

export function reduceFinishingPath(
  points: ReadonlyArray<FinishingPoint>,
  toleranceMm: number = FINISHING_REDUCTION_TOLERANCE_MM,
): ReadonlyArray<FinishingPoint> {
  const first = points[0];
  if (first === undefined || points.length < 3) return points;
  const out: FinishingPoint[] = [first];
  let anchor = 0;
  while (anchor < points.length - 1) {
    anchor = farthestReach(points, anchor, toleranceMm);
    const kept = points[anchor];
    if (kept !== undefined) out.push(kept);
  }
  return out;
}

// The farthest vertex a straight segment from `anchor` can reach while every
// vertex it skips lies on the same XY line, in order, at or below the segment
// and within the tolerance of it. Constraints on the segment's slope from each
// skipped vertex intersect, so the scan is linear.
function farthestReach(
  points: ReadonlyArray<FinishingPoint>,
  anchor: number,
  toleranceMm: number,
): number {
  const a = points[anchor];
  const next = points[anchor + 1];
  if (a === undefined || next === undefined) return anchor + 1;
  const length = Math.sqrt((next.x - a.x) ** 2 + (next.y - a.y) ** 2);
  if (!(length > 0)) return anchor + 1;
  const ux = (next.x - a.x) / length;
  const uy = (next.y - a.y) / length;
  let lowSlope = Number.NEGATIVE_INFINITY;
  let highSlope = Number.POSITIVE_INFINITY;
  let skippedS = length;
  let reach = anchor + 1;
  for (let j = anchor + 1; j + 1 < points.length; j += 1) {
    const skipped = points[j];
    const candidate = points[j + 1];
    if (skipped === undefined || candidate === undefined) break;
    lowSlope = Math.max(lowSlope, (skipped.z - a.z) / skippedS);
    highSlope = Math.min(highSlope, (skipped.z + toleranceMm - a.z) / skippedS);
    const candidateS = (candidate.x - a.x) * ux + (candidate.y - a.y) * uy;
    const offLine = (candidate.x - a.x) * uy - (candidate.y - a.y) * ux;
    if (Math.abs(offLine) > COLLINEAR_MM || !(candidateS > skippedS)) break;
    const slope = (candidate.z - a.z) / candidateS;
    if (slope < lowSlope || slope > highSlope) break;
    reach = j + 1;
    skippedS = candidateS;
  }
  return reach;
}
