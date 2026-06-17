// computeJobBounds — AABB across every cut segment in a compiled Job.
// Used by F-B4 Frame to drive the laser around the perimeter of the planned
// cut, and (future) by preflight to short-circuit the per-point bounds
// check on jobs whose AABB already fails.

import { assertNever } from '../scene';
import { effectiveOverscanMm, expandFillHatchWithOverscan } from './fill-overscan';
import { groupFillSweeps } from './fill-sweeps';
import type { CutGroup, FillGroup, Group, Job, RasterGroup } from './job';

export type JobBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeJobBounds(job: Job): JobBounds | null {
  return computeBounds(job, false);
}

// Full physical motion envelope, including laser-off acceleration runways.
// Frame still traces computeJobBounds(), but safety gates use this helper so a
// burn-area frame cannot approve a Start job whose overscan would leave the bed.
export function computeJobMotionBounds(job: Job): JobBounds | null {
  return computeBounds(job, true);
}

function computeBounds(job: Job, includeOverscanMotion: boolean): JobBounds | null {
  const b: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let any = false;
  for (const group of job.groups) {
    if (extendBoundsForGroup(b, group, includeOverscanMotion)) any = true;
  }
  return any ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null;
}

// Returns true if the group contributed any point to the AABB.
function extendBoundsForGroup(
  b: MutableBounds,
  group: Group,
  includeOverscanMotion: boolean,
): boolean {
  switch (group.kind) {
    case 'cut':
      return extendBoundsForCut(b, group);
    case 'fill':
      return extendBoundsForFill(b, group, includeOverscanMotion);
    case 'raster':
      return extendBoundsForRaster(b, group, includeOverscanMotion);
    default:
      return assertNever(group, 'Group');
  }
}

function extendBoundsForCut(b: MutableBounds, group: CutGroup | FillGroup): boolean {
  let any = false;
  for (const seg of group.segments) {
    for (const p of seg.polyline) {
      extendBoundsForPoint(b, p);
      any = true;
    }
  }
  return any;
}

function extendBoundsForFill(
  b: MutableBounds,
  group: FillGroup,
  includeOverscanMotion: boolean,
): boolean {
  const any = extendBoundsForCut(b, group);
  if (!includeOverscanMotion || (group.fillStyle ?? 'scanline') === 'offset') return any;
  for (const sweep of groupFillSweeps(group.segments)) {
    const first = sweep.spans[0];
    const last = sweep.spans[sweep.spans.length - 1];
    if (first === undefined || last === undefined) continue;
    const burnRun = [first.start, last.end] as const;
    const overscan = effectiveOverscanMm(burnRun, group.overscanMm);
    const run = expandFillHatchWithOverscan(burnRun, overscan);
    if (run === null) continue;
    extendBoundsForPoint(b, run.leadStart);
    extendBoundsForPoint(b, run.leadEnd);
  }
  return any;
}

// F.2.d: raster groups carry their burn bounds directly. Motion bounds add
// overscan only for safety checks; Frame still traces the burn area itself.
function extendBoundsForRaster(
  b: MutableBounds,
  group: RasterGroup,
  includeOverscanMotion: boolean,
): boolean {
  if (group.bounds.minX < b.minX) b.minX = group.bounds.minX;
  if (group.bounds.maxX > b.maxX) b.maxX = group.bounds.maxX;
  if (group.bounds.minY < b.minY) b.minY = group.bounds.minY;
  if (group.bounds.maxY > b.maxY) b.maxY = group.bounds.maxY;
  if (includeOverscanMotion && hasActiveRasterPixel(group)) {
    const shift = rasterScanShiftRange(group);
    b.minX = Math.min(b.minX, group.bounds.minX + shift.minX - group.overscanMm);
    b.maxX = Math.max(b.maxX, group.bounds.maxX + shift.maxX + group.overscanMm);
  }
  return true;
}

function extendBoundsForPoint(
  b: MutableBounds,
  p: { readonly x: number; readonly y: number },
): void {
  if (p.x < b.minX) b.minX = p.x;
  if (p.x > b.maxX) b.maxX = p.x;
  if (p.y < b.minY) b.minY = p.y;
  if (p.y > b.maxY) b.maxY = p.y;
}

function hasActiveRasterPixel(group: RasterGroup): boolean {
  for (const s of group.sValues) {
    if (s > 0) return true;
  }
  return false;
}

function rasterScanShiftRange(group: RasterGroup): {
  readonly minX: number;
  readonly maxX: number;
} {
  const initialX = finiteOrZero(group.initialXOffsetMm);
  const bidirectional = Math.abs(finiteOrZero(group.bidirectionalScanOffsetMm));
  return { minX: initialX - bidirectional, maxX: initialX + bidirectional };
}

function finiteOrZero(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}
