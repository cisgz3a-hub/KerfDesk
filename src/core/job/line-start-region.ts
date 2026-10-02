import type { Origin } from '../devices';
import type { Vec2 } from '../scene';
import type { LineStartRegion } from '../scene/project';
import type { CutGroup, Job } from './job';
import { anchorPointForOrigin } from './job-origin';
import { polylineBounds } from './segment-bounds';

/** A seed near the selected physical region of the final placed Line artwork.
 * Ordering still chooses an existing eligible entry; this creates no burn point. */
export function lineStartCursorForJob(
  job: Job,
  region: LineStartRegion | undefined,
  origin: Origin,
): Vec2 | null {
  if (region === undefined) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const group of job.groups) {
    if (group.kind !== 'cut' || !isBurningLineGroup(group)) continue;
    for (const segment of group.segments) {
      if (segment.polyline.length < 2) continue;
      const bounds = polylineBounds(segment.polyline);
      if (bounds === null) continue;
      // A repeated point has no contour motion and cannot be a burn entry.
      if (bounds.minX === bounds.maxX && bounds.minY === bounds.maxY) continue;
      minX = Math.min(minX, bounds.minX);
      minY = Math.min(minY, bounds.minY);
      maxX = Math.max(maxX, bounds.maxX);
      maxY = Math.max(maxY, bounds.maxY);
    }
  }
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return anchorPointForOrigin({ minX, minY, maxX, maxY }, region, origin);
}

export function isBurningLineGroup(group: CutGroup): boolean {
  return group.power > 0 && group.passes > 0;
}
