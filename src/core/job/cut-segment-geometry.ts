import type { ArcMove } from '../geometry/arc-fit';
import type { Vec2 } from '../scene';

/** Fitted line/arc moves for a CutSegment (ADR-432), with a fingerprint of
 * the polyline they were fitted against: they start at `from` and the last
 * lands exactly on the polyline's last point. A reader trusts them only while
 * the polyline still matches the fingerprint. */
export type CutArcMoves = {
  readonly moves: ReadonlyArray<ArcMove>;
  readonly from: Vec2;
  readonly pointCount: number;
  readonly lengthMm: number;
};

/** ADR-626: on a contour given leads, where the closed contour lies in
 * `polyline` (first and last index, inclusive), so editing where a job
 * starts can still pick supported points on it (jobWithoutLeads). Native
 * contour moves retain their fingerprint and move-boundary start policy. */
export type LeadContour = {
  readonly from: number;
  readonly to: number;
  readonly arcMoves?: CutArcMoves;
};
