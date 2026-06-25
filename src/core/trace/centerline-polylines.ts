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

export type CenterlinePolylineOptions = {
  // Accepted for call-site compatibility; the chunk tracer does not consult the
  // distance transform (it prunes nothing by stroke radius).
  readonly distanceSq?: Float64Array;
  readonly simplifyTolerancePx?: number;
};

export function extractCenterlinePolylines(
  mask: Uint8Array,
  width: number,
  height: number,
  options: CenterlinePolylineOptions = {},
): Polyline[] {
  const simplifyTolerancePx = options.simplifyTolerancePx ?? DEFAULT_SIMPLIFY_TOLERANCE_PX;
  const segments = traceSkeletonToSegments(mask, width, height);
  return chainBranches(segments)
    .map((pixels) => pixelsToPolyline(pixels, simplifyTolerancePx))
    .filter(shouldKeepPolyline);
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

function shouldKeepPolyline(polyline: Polyline): boolean {
  if (polyline.points.length < 2) return false;
  return polylineLength(polyline.points) >= MIN_CENTERLINE_LENGTH_PX;
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

// Skeleton pixel indices index pixel CELLS; the centerline lives at cell
// centres, matching the source's pixel-centre sampling convention.
function pixelCenter(pixel: Vec2): Vec2 {
  return { x: pixel.x + 0.5, y: pixel.y + 0.5 };
}
