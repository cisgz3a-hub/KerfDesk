// Where each closed Line cut starts burning and which way it runs (ADR-385).
//
// Read from the prepared job — the same segments, in the same order, that the
// emitters walk — so a marker is the G-code entry point by construction, not a
// second guess at it. Open cuts and bridges left by tabs have fixed ends, so
// only closed segments are marked.

import type { Vec2 } from '../scene';
import type { CutSegment, Job } from './job';

export type CutStartMarker = {
  readonly at: Vec2;
  /** Unit vector along the first cut edge: the direction the loop runs. */
  readonly direction: Vec2;
  /** The operator placed this start (Set Start Point). */
  readonly operatorSet: boolean;
};

/** Past this many the marks are unreadable anyway; the first ones in cut order
 * are kept so a dense job stays cheap to prepare and to draw. */
export const MAX_CUT_START_MARKERS = 20_000;

const MIN_EDGE_MM = 1e-9;

export function closedCutStartMarkers(
  job: Job,
  limit: number = MAX_CUT_START_MARKERS,
): ReadonlyArray<CutStartMarker> {
  const markers: CutStartMarker[] = [];
  for (const group of job.groups) {
    if (group.kind !== 'cut') continue;
    for (const segment of group.segments) {
      if (markers.length >= limit) return markers;
      if (!segment.closed) continue;
      const marker = startMarker(segment);
      if (marker !== null) markers.push(marker);
    }
  }
  return markers;
}

function startMarker(segment: CutSegment): CutStartMarker | null {
  const at = segment.polyline[0];
  if (at === undefined) return null;
  // Skip repeated points so the arrow follows the first edge that moves.
  for (let index = 1; index < segment.polyline.length; index += 1) {
    const next = segment.polyline[index];
    if (next === undefined) break;
    const length = Math.hypot(next.x - at.x, next.y - at.y);
    if (length <= MIN_EDGE_MM) continue;
    return {
      at,
      direction: { x: (next.x - at.x) / length, y: (next.y - at.y) / length },
      operatorSet: segment.startLocked === true,
    };
  }
  return null;
}
