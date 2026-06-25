import type { Polyline, Vec2 } from '../scene';
import { chainBranches } from './centerline-chain';
import { fitCenterlinePoints } from './centerline-fit';

const MIN_CENTERLINE_LENGTH_PX = 3;
const SPUR_BRANCH_MAX_PX = 4;
const SPUR_RADIUS_FACTOR = 2;
const DEFAULT_SIMPLIFY_TOLERANCE_PX = 1;
const CENTERLINE_SAMPLE_STEP_PX = 4;

type Pixel = {
  readonly x: number;
  readonly y: number;
};

type SkeletonBranch = {
  readonly pixels: ReadonlyArray<Pixel>;
  readonly startDegree: number;
  readonly endDegree: number;
  readonly length: number;
  readonly maxRadius: number;
};

export type CenterlinePolylineOptions = {
  readonly distanceSq?: Float64Array;
  readonly simplifyTolerancePx?: number;
};

export function extractCenterlinePolylines(
  mask: Uint8Array,
  width: number,
  height: number,
  options: CenterlinePolylineOptions = {},
): Polyline[] {
  const visitedEdges = new Set<string>();
  const branches: SkeletonBranch[] = [];
  traceFromGraphNodes(mask, width, height, options.distanceSq, visitedEdges, branches);
  traceRemainingLoops(mask, width, height, options.distanceSq, visitedEdges, branches);
  const usableBranches = branches.filter(hasUsableBranch);
  const keptBranches = usableBranches.filter(shouldKeepBranch);
  const selectedBranches = keptBranches.length === 0 ? usableBranches : keptBranches;
  const simplifyTolerancePx = options.simplifyTolerancePx ?? DEFAULT_SIMPLIFY_TOLERANCE_PX;
  // Stitch edges through junctions into connected strokes BEFORE fitting, so a
  // glyph stays one polyline instead of one fragment per edge (ADR-058). This
  // supersedes the old collinear-only merge, which left curves/corners split.
  return chainBranches(selectedBranches.map((branch) => branch.pixels))
    .map((pixels) => pixelsToPolyline(pixels, simplifyTolerancePx))
    .filter(shouldKeepPolyline);
}

function traceFromGraphNodes(
  mask: Uint8Array,
  width: number,
  height: number,
  distanceSq: Float64Array | undefined,
  visitedEdges: Set<string>,
  out: SkeletonBranch[],
): void {
  forEachSkeletonPixel(mask, width, height, (start) => {
    if (degree(mask, width, height, start) === 2) return;
    for (const next of pixelNeighbors(mask, width, height, start)) {
      if (visitedEdges.has(edgeKey(start, next, width))) continue;
      out.push(
        buildBranch(
          mask,
          width,
          height,
          walkEdge(mask, width, height, start, next, visitedEdges),
          distanceSq,
        ),
      );
    }
  });
}

function traceRemainingLoops(
  mask: Uint8Array,
  width: number,
  height: number,
  distanceSq: Float64Array | undefined,
  visitedEdges: Set<string>,
  out: SkeletonBranch[],
): void {
  forEachSkeletonPixel(mask, width, height, (start) => {
    for (const next of pixelNeighbors(mask, width, height, start)) {
      if (visitedEdges.has(edgeKey(start, next, width))) continue;
      out.push(
        buildBranch(
          mask,
          width,
          height,
          walkEdge(mask, width, height, start, next, visitedEdges),
          distanceSq,
        ),
      );
    }
  });
}

function buildBranch(
  mask: Uint8Array,
  width: number,
  height: number,
  pixels: ReadonlyArray<Pixel>,
  distanceSq: Float64Array | undefined,
): SkeletonBranch {
  const start = pixels[0];
  const end = pixels[pixels.length - 1];
  return {
    pixels,
    startDegree: start === undefined ? 0 : degree(mask, width, height, start),
    endDegree: end === undefined ? 0 : degree(mask, width, height, end),
    length: pixelPathLength(pixels),
    maxRadius: maxBranchRadius(pixels, width, distanceSq),
  };
}

function shouldKeepBranch(branch: SkeletonBranch): boolean {
  if (!hasUsableBranch(branch)) return false;
  if (!isEndpointToJunction(branch)) return true;
  const spurLimit = Math.max(SPUR_BRANCH_MAX_PX, branch.maxRadius * SPUR_RADIUS_FACTOR);
  return branch.length > spurLimit;
}

function hasUsableBranch(branch: SkeletonBranch): boolean {
  return branch.pixels.length >= 2 && branch.length >= MIN_CENTERLINE_LENGTH_PX;
}

function isEndpointToJunction(branch: SkeletonBranch): boolean {
  const hasEndpoint = branch.startDegree <= 1 || branch.endDegree <= 1;
  const hasJunction = branch.startDegree > 2 || branch.endDegree > 2;
  return hasEndpoint && hasJunction;
}

function pixelsToPolyline(
  pixels: ReadonlyArray<Pixel>,
  simplifyTolerancePx = DEFAULT_SIMPLIFY_TOLERANCE_PX,
): Polyline {
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

function walkEdge(
  mask: Uint8Array,
  width: number,
  height: number,
  start: Pixel,
  firstNext: Pixel,
  visitedEdges: Set<string>,
): Pixel[] {
  const path: Pixel[] = [start, firstNext];
  let prev = start;
  let curr = firstNext;
  visitedEdges.add(edgeKey(prev, curr, width));
  let guard = 0;
  while (guard < mask.length) {
    guard += 1;
    if (samePixel(curr, start) || degree(mask, width, height, curr) !== 2) break;
    const next = nextUnvisitedNeighbor(mask, width, height, prev, curr, visitedEdges);
    if (next === null) break;
    visitedEdges.add(edgeKey(curr, next, width));
    path.push(next);
    prev = curr;
    curr = next;
  }
  return path;
}

function nextUnvisitedNeighbor(
  mask: Uint8Array,
  width: number,
  height: number,
  prev: Pixel,
  curr: Pixel,
  visitedEdges: Set<string>,
): Pixel | null {
  for (const next of pixelNeighbors(mask, width, height, curr)) {
    if (samePixel(next, prev)) continue;
    if (!visitedEdges.has(edgeKey(curr, next, width))) return next;
  }
  return null;
}

function maxBranchRadius(
  pixels: ReadonlyArray<Pixel>,
  width: number,
  distanceSq: Float64Array | undefined,
): number {
  if (distanceSq === undefined) return 0;
  let max = 0;
  for (const pixel of pixels) {
    max = Math.max(max, Math.sqrt(distanceSq[indexOf(pixel.x, pixel.y, width)] ?? 0));
  }
  return max;
}

function pixelPathLength(pixels: ReadonlyArray<Pixel>): number {
  let total = 0;
  for (let i = 0; i + 1 < pixels.length; i += 1) {
    const a = pixels[i];
    const b = pixels[i + 1];
    if (a === undefined || b === undefined) continue;
    total += Math.hypot(a.x - b.x, a.y - b.y);
  }
  return total;
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

function forEachSkeletonPixel(
  mask: Uint8Array,
  width: number,
  height: number,
  visit: (pixel: Pixel) => void,
): void {
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (mask[indexOf(x, y, width)] === 1) visit({ x, y });
    }
  }
}

function pixelNeighbors(mask: Uint8Array, width: number, height: number, pixel: Pixel): Pixel[] {
  const out: Pixel[] = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const x = pixel.x + dx;
      const y = pixel.y + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (mask[indexOf(x, y, width)] === 1) out.push({ x, y });
    }
  }
  return out;
}

function degree(mask: Uint8Array, width: number, height: number, pixel: Pixel): number {
  return pixelNeighbors(mask, width, height, pixel).length;
}

function pixelCenter(pixel: Pixel): Vec2 {
  return { x: pixel.x + 0.5, y: pixel.y + 0.5 };
}

function edgeKey(a: Pixel, b: Pixel, width: number): string {
  const ai = indexOf(a.x, a.y, width);
  const bi = indexOf(b.x, b.y, width);
  return ai < bi ? `${ai}:${bi}` : `${bi}:${ai}`;
}

function samePixel(a: Pixel, b: Pixel): boolean {
  return a.x === b.x && a.y === b.y;
}

function indexOf(x: number, y: number, width: number): number {
  return y * width + x;
}
