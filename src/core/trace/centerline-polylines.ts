// Centerline polyline extraction (ADR-058). The skeleton is traced by the
// divide-and-conquer chunk tracer (centerline-divide) — robust to skeleton
// imperfections — its segments are stitched through junctions by chainBranches,
// and each stitched stroke is fitted to a smooth polyline. This replaced a
// graph-walk extractor whose 8-neighbour degree test shattered curves at the
// spurious junctions that 8-connectivity produces.

import type { Polyline, Vec2 } from '../scene';
import { chainBranches } from './centerline-chain';
import { traceSkeletonToSegments } from './centerline-divide';
import { fitCenterlinePoints } from './centerline-fit';

const MIN_CENTERLINE_LENGTH_PX = 3;
const DEFAULT_SIMPLIFY_TOLERANCE_PX = 1;
const CENTERLINE_SAMPLE_STEP_PX = 4;
// Distance-aware pruning only removes short branches attached to a longer
// centerline. Standalone small marks survive the global min-length check.
const DISTANCE_AWARE_SPUR_FACTOR = 3.25;
const DISTANCE_AWARE_SPUR_LIMIT_PX = 12;
const DISTANCE_AWARE_SPUR_FLOOR_PX = 10;
const LONG_BRANCH_RATIO = 1.75;
const ATTACHED_ENDPOINT_PAD_PX = 1.5;

type CenterlineCandidate = {
  readonly polyline: Polyline;
  readonly localRadiusPx: number;
};

export type CenterlinePolylineOptions = {
  readonly distanceSq?: Float64Array;
  readonly simplifyTolerancePx?: number;
  readonly minLengthPx?: number;
};

export function extractCenterlinePolylines(
  mask: Uint8Array,
  width: number,
  height: number,
  options: CenterlinePolylineOptions = {},
): Polyline[] {
  const simplifyTolerancePx = options.simplifyTolerancePx ?? DEFAULT_SIMPLIFY_TOLERANCE_PX;
  const minLengthPx = options.minLengthPx ?? MIN_CENTERLINE_LENGTH_PX;
  const segments = traceSkeletonToSegments(mask, width, height);
  const candidates = chainBranches(segments)
    .filter((pixels) => pixelPathLength(pixels) >= Math.max(0, minLengthPx))
    .map((pixels) => ({
      polyline: pixelsToPolyline(pixels, simplifyTolerancePx),
      localRadiusPx: options.distanceSq ? maxLocalRadiusPx(pixels, width, options.distanceSq) : 0,
    }));
  return candidates
    .filter((candidate) =>
      shouldKeepCandidate(candidate, candidates, minLengthPx, options.distanceSq),
    )
    .map((candidate) => candidate.polyline);
}

function shouldKeepCandidate(
  candidate: CenterlineCandidate,
  allCandidates: ReadonlyArray<CenterlineCandidate>,
  minLengthPx: number,
  distanceSq: Float64Array | undefined,
): boolean {
  const lengthPx = polylineLength(candidate.polyline.points);
  if (lengthPx < Math.max(0, minLengthPx)) return false;
  if (distanceSq === undefined) return true;
  const distanceAwareMinLengthPx = Math.min(
    DISTANCE_AWARE_SPUR_LIMIT_PX,
    Math.max(DISTANCE_AWARE_SPUR_FLOOR_PX, candidate.localRadiusPx * DISTANCE_AWARE_SPUR_FACTOR),
  );
  if (lengthPx >= Math.max(minLengthPx, distanceAwareMinLengthPx)) return true;
  return !isAttachedToLongerCandidate(candidate, allCandidates, lengthPx);
}

function maxLocalRadiusPx(
  pixels: ReadonlyArray<Vec2>,
  width: number,
  distanceSq: Float64Array,
): number {
  let max = 0;
  for (const pixel of pixels) {
    const radius = Math.sqrt(distanceSq[pixel.y * width + pixel.x] ?? 0);
    if (Number.isFinite(radius) && radius > max) max = radius;
  }
  return max;
}

function isAttachedToLongerCandidate(
  candidate: CenterlineCandidate,
  allCandidates: ReadonlyArray<CenterlineCandidate>,
  lengthPx: number,
): boolean {
  const first = candidate.polyline.points[0];
  const last = candidate.polyline.points[candidate.polyline.points.length - 1];
  if (first === undefined || last === undefined) return false;
  const attachDistancePx = Math.max(2, candidate.localRadiusPx + ATTACHED_ENDPOINT_PAD_PX);
  for (const other of allCandidates) {
    if (other === candidate) continue;
    if (polylineLength(other.polyline.points) < lengthPx * LONG_BRANCH_RATIO) continue;
    if (
      distanceToPolyline(first, other.polyline.points) <= attachDistancePx ||
      distanceToPolyline(last, other.polyline.points) <= attachDistancePx
    ) {
      return true;
    }
  }
  return false;
}

function distanceToPolyline(point: Vec2, points: ReadonlyArray<Vec2>): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    const d = distanceToSegment(point, a, b);
    if (d < best) best = d;
  }
  if (best < Number.POSITIVE_INFINITY) return best;
  const only = points[0];
  return only === undefined ? best : Math.hypot(point.x - only.x, point.y - only.y);
}

function distanceToSegment(point: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function pixelsToPolyline(pixels: ReadonlyArray<Vec2>, simplifyTolerancePx: number): Polyline {
  const points = pixels.map(pixelCenter);
  return {
    closed: false,
    points: fitCenterlinePoints(points, {
      fitTolerancePx: Math.max(0, simplifyTolerancePx),
      linearTolerancePx: Math.max(0.75, simplifyTolerancePx),
      sampleStepPx: CENTERLINE_SAMPLE_STEP_PX,
    }),
  };
}

function polylineLength(points: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

function pixelPathLength(pixels: ReadonlyArray<Vec2>): number {
  let total = 0;
  for (let i = 0; i + 1 < pixels.length; i += 1) {
    const a = pixels[i];
    const b = pixels[i + 1];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
}

// Skeleton pixel indices index pixel CELLS; the centerline lives at cell
// centres, matching the source's pixel-centre sampling convention.
function pixelCenter(pixel: Vec2): Vec2 {
  return { x: pixel.x + 0.5, y: pixel.y + 0.5 };
}
