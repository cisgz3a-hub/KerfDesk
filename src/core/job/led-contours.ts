// The contours laser leads were added to, read back as the closed contours
// they were (ADR-626). A led contour is one open burn, so editing where a job
// starts would see only the two ends of its leads; it needs the outline, on
// whose supported points can be the start; native arcs retain their move
// boundaries. The leads follow wherever that supported start is.

import { validCutArcMoves, withoutArcMoves } from './cut-arc-moves';
import type { CutSegment, Job } from './job';

/** The job with every led contour back as its closed contour; a job without
 * leads is returned as is. */
export function jobWithoutLeads(job: Job): Job {
  if (!job.groups.some((group) => group.kind === 'cut' && group.segments.some(isLed))) return job;
  return {
    ...job,
    groups: job.groups.map((group) =>
      group.kind === 'cut' && group.segments.some(isLed)
        ? { ...group, segments: group.segments.map(contourOf) }
        : group,
    ),
  };
}

function isLed(segment: CutSegment): boolean {
  return segment.leadContour !== undefined;
}

function contourOf(segment: CutSegment): CutSegment {
  const range = segment.leadContour;
  if (range === undefined) return segment;
  const { leadContour: _range, finalPassBurn: _finalPass, ...rest } = withoutArcMoves(segment);
  const contour: CutSegment = {
    ...rest,
    polyline: segment.polyline.slice(range.from, range.to + 1),
    closed: true,
    ...(range.arcMoves === undefined ? {} : { arcMoves: range.arcMoves }),
  };
  // Never re-fingerprint untracked geometry: the retained fit must still
  // belong to this exact contour, as native output requires (ADR-432).
  return validCutArcMoves(contour) === null ? withoutArcMoves(contour) : contour;
}
