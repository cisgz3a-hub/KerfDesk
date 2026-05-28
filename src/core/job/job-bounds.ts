// computeJobBounds — AABB across every cut segment in a compiled Job.
// Used by F-B4 Frame to drive the laser around the perimeter of the planned
// cut, and (future) by preflight to short-circuit the per-point bounds
// check on jobs whose AABB already fails.

import type { CutGroup, Group, Job, RasterGroup } from './job';

export type JobBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeJobBounds(job: Job): JobBounds | null {
  const b: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let any = false;
  for (const group of job.groups) {
    if (extendBoundsForGroup(b, group)) any = true;
  }
  return any ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null;
}

// Returns true if the group contributed any point to the AABB.
function extendBoundsForGroup(b: MutableBounds, group: Group): boolean {
  return group.kind === 'cut' ? extendBoundsForCut(b, group) : extendBoundsForRaster(b, group);
}

function extendBoundsForCut(b: MutableBounds, group: CutGroup): boolean {
  let any = false;
  for (const seg of group.segments) {
    for (const p of seg.polyline) {
      if (p.x < b.minX) b.minX = p.x;
      if (p.x > b.maxX) b.maxX = p.x;
      if (p.y < b.minY) b.minY = p.y;
      if (p.y > b.maxY) b.maxY = p.y;
      any = true;
    }
  }
  return any;
}

// F.2.d: raster groups carry their bounds directly. Used by Frame
// and preflight so they cover image-mode layers too. Overscan is
// intentionally NOT included — Frame traces the burn area, not
// the accel runway.
function extendBoundsForRaster(b: MutableBounds, group: RasterGroup): boolean {
  if (group.bounds.minX < b.minX) b.minX = group.bounds.minX;
  if (group.bounds.maxX > b.maxX) b.maxX = group.bounds.maxX;
  if (group.bounds.minY < b.minY) b.minY = group.bounds.minY;
  if (group.bounds.maxY > b.maxY) b.maxY = group.bounds.maxY;
  return true;
}
