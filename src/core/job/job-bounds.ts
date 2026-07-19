// computeJobBounds — AABB across every cut segment in a compiled Job.
// Used by F-B4 Frame to drive the laser around the perimeter of the planned
// cut, and (future) by preflight to short-circuit the per-point bounds
// check on jobs whose AABB already fails.

import { assertNever } from '../scene';
import type { DeviceProfile } from '../devices';
import { expandFillHatchWithRunways } from './fill-runway';
import { planFillSweeps } from './fill-sweep-plan';
import {
  cncPassXyPoints,
  type CncGroup,
  type CutGroup,
  type FillGroup,
  type Group,
  type Job,
  type RasterGroup,
} from './job';
import { rasterRow } from './raster-rows';
import { offsetForSpeed, shiftAlongTravel } from './scan-offset';

export type JobBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

type MutableBounds = { minX: number; minY: number; maxX: number; maxY: number };

export function computeJobBounds(job: Job, device?: DeviceProfile): JobBounds | null {
  return computeBounds(job, false, device);
}

// Full physical motion envelope, including laser-off acceleration runways.
// Physical Frame traces this envelope so the operator sees the same extents
// the cached executable artifact will travel; computeJobBounds remains the
// artwork/burn-area measurement shown separately in review.
export function computeJobMotionBounds(job: Job, device?: DeviceProfile): JobBounds | null {
  return computeBounds(job, true, device);
}

function computeBounds(
  job: Job,
  includeOverscanMotion: boolean,
  device: DeviceProfile | undefined,
): JobBounds | null {
  const b: MutableBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  let any = false;
  for (const group of job.groups) {
    if (extendBoundsForGroup(b, group, includeOverscanMotion, device)) any = true;
  }
  return any ? { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY } : null;
}

// Returns true if the group contributed any point to the AABB.
function extendBoundsForGroup(
  b: MutableBounds,
  group: Group,
  includeOverscanMotion: boolean,
  device: DeviceProfile | undefined,
): boolean {
  switch (group.kind) {
    case 'cut':
      return extendBoundsForCut(b, group);
    case 'fill':
      return extendBoundsForFill(b, group, includeOverscanMotion, device);
    case 'raster':
      return extendBoundsForRaster(b, group, includeOverscanMotion, device);
    case 'cnc':
      return extendBoundsForCnc(b, group);
    default:
      return assertNever(group, 'Group');
  }
}

function extendBoundsForCnc(b: MutableBounds, group: CncGroup): boolean {
  let any = false;
  for (const pass of group.passes) {
    for (const p of cncPassXyPoints(pass)) {
      extendBoundsForPoint(b, p);
      any = true;
    }
  }
  return any;
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
  device: DeviceProfile | undefined,
): boolean {
  let any = extendBoundsForCut(b, group);
  const scanOffsetMm = scanOffsetForGroup(device, group.speed);
  const plans = planFillSweeps(group);
  for (const plan of plans) {
    const sweep = plan.sweep;
    const spans =
      sweep.reverse && scanOffsetMm !== 0
        ? sweep.spans.map((span) => {
            const shifted = shiftAlongTravel(span.start, span.end, scanOffsetMm);
            return { start: shifted.from, end: shifted.to };
          })
        : sweep.spans;
    if (sweep.reverse && scanOffsetMm !== 0) {
      for (const span of spans) {
        extendBoundsForPoint(b, span.start);
        extendBoundsForPoint(b, span.end);
        any = true;
      }
    }
    if (!includeOverscanMotion) continue;
    const first = spans[0];
    const last = spans[spans.length - 1];
    if (first === undefined || last === undefined) continue;
    const burnRun = [first.start, last.end] as const;
    const run = expandFillHatchWithRunways(burnRun, plan);
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
  device: DeviceProfile | undefined,
): boolean {
  const scanOffsetMm = scanOffsetForGroup(device, group.speed);
  const reverseShiftX = hasActiveReverseRasterRow(group) ? -scanOffsetMm : 0;
  if (group.bounds.minX < b.minX) b.minX = group.bounds.minX;
  if (group.bounds.maxX > b.maxX) b.maxX = group.bounds.maxX;
  if (group.bounds.minY < b.minY) b.minY = group.bounds.minY;
  if (group.bounds.maxY > b.maxY) b.maxY = group.bounds.maxY;
  if (reverseShiftX !== 0) {
    b.minX = Math.min(b.minX, group.bounds.minX + reverseShiftX);
    b.maxX = Math.max(b.maxX, group.bounds.maxX + reverseShiftX);
  }
  if (includeOverscanMotion && hasActiveRasterPixel(group)) {
    b.minX = Math.min(b.minX, group.bounds.minX - group.overscanMm);
    b.maxX = Math.max(b.maxX, group.bounds.maxX + group.overscanMm);
    if (reverseShiftX !== 0) {
      b.minX = Math.min(b.minX, group.bounds.minX - group.overscanMm + reverseShiftX);
      b.maxX = Math.max(b.maxX, group.bounds.maxX + group.overscanMm + reverseShiftX);
    }
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
  for (let y = 0; y < group.pixelHeight; y += 1)
    if (rasterRow(group, y).some((s) => s > 0)) return true;
  return false;
}

function hasActiveReverseRasterRow(group: RasterGroup): boolean {
  if (group.bidirectional === false) return false;
  let emittedRowCount = 0;
  for (let y = 0; y < group.pixelHeight; y += 1) {
    if (!hasActivePixelInRasterRow(group, y)) continue;
    if (emittedRowCount % 2 === 1) return true;
    emittedRowCount += 1;
  }
  return false;
}

function hasActivePixelInRasterRow(group: RasterGroup, y: number): boolean {
  return rasterRow(group, y).some((s) => s > 0);
}

function scanOffsetForGroup(device: DeviceProfile | undefined, speed: number): number {
  return device === undefined ? 0 : offsetForSpeed(device.scanningOffsets, speed);
}
