import type { VCarveMedialGraph, VCarveMedialNode } from './vcarve-medial-axis';
import {
  minimumVCarveBoundaryDistance,
  vcarveChordInsideRegion,
  type VCarveBoundarySegment,
  type VCarveMedialRegion,
} from './vcarve-medial-region';

export type VCarveMedialWalkPoint = VCarveMedialNode & { readonly nodeIndex: number };

export function simplifyVCarveMedialWalk(
  walk: ReadonlyArray<VCarveMedialWalkPoint>,
  graph: VCarveMedialGraph,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  toleranceMm: number,
  sweepToleranceMm: number,
  clearanceCapMm: number,
): ReadonlyArray<VCarveMedialWalkPoint> {
  if (!(toleranceMm > 0) || walk.length <= 2) return walk;
  const protectedIndices = protectedWalkIndices(walk, graph);
  const stops = [...protectedIndices].sort((a, b) => a - b);
  const keep = new Set<number>(stops);
  for (let index = 0; index < stops.length - 1; index += 1) {
    const low = stops[index];
    const high = stops[index + 1];
    if (low !== undefined && high !== undefined) {
      simplifySpan(
        walk,
        low,
        high,
        toleranceMm,
        sweepToleranceMm,
        clearanceCapMm,
        region,
        segments,
        keep,
      );
    }
  }
  return walk.filter((_, index) => keep.has(index));
}

function protectedWalkIndices(
  walk: ReadonlyArray<VCarveMedialWalkPoint>,
  graph: VCarveMedialGraph,
): Set<number> {
  const protectedIndices = new Set<number>([0, walk.length - 1]);
  walk.forEach((point, index) => {
    if ((graph.adjacency[point.nodeIndex]?.length ?? 0) !== 2) protectedIndices.add(index);
  });
  protectedIndices.add(maximumClearanceIndex(walk));
  const first = walk[0];
  if (
    first !== undefined &&
    protectedIndices.size === 2 &&
    first.nodeIndex === walk.at(-1)?.nodeIndex
  ) {
    protectedIndices.add(farthestIndex(walk, first));
  }
  return protectedIndices;
}

function maximumClearanceIndex(points: ReadonlyArray<VCarveMedialWalkPoint>): number {
  return points.reduce(
    (best, point, index) => (point.clearanceMm > (points[best]?.clearanceMm ?? -1) ? index : best),
    0,
  );
}

function simplifySpan(
  walk: ReadonlyArray<VCarveMedialWalkPoint>,
  low: number,
  high: number,
  toleranceMm: number,
  sweepToleranceMm: number,
  clearanceCapMm: number,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  keep: Set<number>,
): void {
  const pending: Array<readonly [number, number]> = [[low, high]];
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined || span[1] - span[0] < 2) continue;
    const a = walk[span[0]];
    const b = walk[span[1]];
    if (a === undefined || b === undefined) continue;
    const split = splitForSpan(
      walk,
      span[0],
      span[1],
      a,
      b,
      toleranceMm,
      sweepToleranceMm,
      clearanceCapMm,
      region,
      segments,
    );
    if (split >= 0) {
      keep.add(split);
      pending.push([span[0], split], [split, span[1]]);
    }
  }
}

function splitForSpan(
  walk: ReadonlyArray<VCarveMedialWalkPoint>,
  low: number,
  high: number,
  a: VCarveMedialWalkPoint,
  b: VCarveMedialWalkPoint,
  toleranceMm: number,
  sweepToleranceMm: number,
  clearanceCapMm: number,
  region: VCarveMedialRegion,
  segments: ReadonlyArray<VCarveBoundarySegment>,
): number {
  const deviation = maximumSplit(walk, low, high, toleranceMm, (point) =>
    medialDeviation(point, a, b),
  );
  if (deviation >= 0) return deviation;
  const swept = maximumSplit(walk, low, high, sweepToleranceMm, (point) =>
    sweptDiskLoss(point, a, b, segments, clearanceCapMm),
  );
  if (swept >= 0 || vcarveChordInsideRegion(a, b, region, segments)) return swept;
  return Math.floor((low + high) / 2);
}

function maximumSplit(
  walk: ReadonlyArray<VCarveMedialWalkPoint>,
  low: number,
  high: number,
  toleranceMm: number,
  measure: (point: VCarveMedialWalkPoint) => number,
): number {
  let split = -1;
  let maximum = toleranceMm;
  for (let index = low + 1; index < high; index += 1) {
    const point = walk[index];
    if (point === undefined) continue;
    const value = measure(point);
    if (value <= maximum) continue;
    maximum = value;
    split = index;
  }
  return split;
}

/** Analytic screen; formatted XYZ coverage is certified after this stage. */
function sweptDiskLoss(
  point: VCarveMedialWalkPoint,
  a: VCarveMedialWalkPoint,
  b: VCarveMedialWalkPoint,
  segments: ReadonlyArray<VCarveBoundarySegment>,
  clearanceCapMm: number,
): number {
  const projection = projectedPoint(point, a, b);
  const centerDistance = Math.hypot(point.x - projection.x, point.y - projection.y);
  const sourceRadius = Math.min(point.clearanceMm, clearanceCapMm);
  const shortcutRadius = Math.min(
    minimumVCarveBoundaryDistance(projection, segments),
    clearanceCapMm,
  );
  return centerDistance + sourceRadius - shortcutRadius;
}

function medialDeviation(
  point: VCarveMedialWalkPoint,
  a: VCarveMedialWalkPoint,
  b: VCarveMedialWalkPoint,
): number {
  const projection = projectedPoint(point, a, b);
  const xy = Math.hypot(point.x - projection.x, point.y - projection.y);
  const clearance = Math.abs(
    point.clearanceMm - (a.clearanceMm + (b.clearanceMm - a.clearanceMm) * projection.t),
  );
  return Math.max(xy, clearance);
}

function projectedPoint(
  point: VCarveMedialWalkPoint,
  a: VCarveMedialWalkPoint,
  b: VCarveMedialWalkPoint,
): { readonly x: number; readonly y: number; readonly t: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return { x: a.x + dx * t, y: a.y + dy * t, t };
}

function farthestIndex(
  points: ReadonlyArray<VCarveMedialWalkPoint>,
  origin: VCarveMedialWalkPoint,
): number {
  let best = 0;
  let bestDistance = -1;
  points.forEach((point, index) => {
    const distance = Math.hypot(point.x - origin.x, point.y - origin.y);
    if (distance > bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return best;
}
