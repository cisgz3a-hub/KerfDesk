// computeJobBounds — AABB across every cut segment in a compiled Job.
// Used by F-B4 Frame to drive the laser around the perimeter of the planned
// cut, and (future) by preflight to short-circuit the per-point bounds
// check on jobs whose AABB already fails.

import type { Job } from './job';

export type JobBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function computeJobBounds(job: Job): JobBounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const group of job.groups) {
    for (const seg of group.segments) {
      for (const p of seg.polyline) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.y > maxY) maxY = p.y;
        any = true;
      }
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}
