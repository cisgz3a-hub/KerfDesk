// Overcut runs on the final pass only (ADR-415, as LightBurn does): earlier
// passes cut each closed contour exactly once round, and the last pass carries
// on past the start by the group's overcut. Every consumer that walks a Line
// group's passes (G-code emission, the Ruida motion plan, the preview route)
// takes the final pass's segments from here, so they cannot disagree.

import { overcutClosedPolyline } from '../geometry/overcut';
import type { CutGroup, CutSegment } from './job';

export function finalPassCutSegments(
  group: Pick<CutGroup, 'segments' | 'finalPassOvercutMm'>,
): ReadonlyArray<CutSegment> {
  const overcutMm = group.finalPassOvercutMm ?? 0;
  if (!(overcutMm > 0)) return group.segments;
  return group.segments.map((segment) =>
    segment.closed
      ? { ...segment, polyline: overcutClosedPolyline(segment.polyline, overcutMm) }
      : segment,
  );
}

/** The segments pass `passIndex` (0-based) of `passes` cuts. */
export function cutSegmentsForPass(
  group: Pick<CutGroup, 'segments'>,
  finalPass: ReadonlyArray<CutSegment>,
  passIndex: number,
  passes: number,
): ReadonlyArray<CutSegment> {
  return passIndex === passes - 1 ? finalPass : group.segments;
}
