// Edge Detection trace (ADR-059, rebuilt): Canny edge map → chained single
// polylines. The old implementation OUTLINED the 1-px edge mask with the
// filled-contour backend, so every detected edge came back as a two-sided
// sausage contour — a doubled line everywhere. Canny's non-max-suppressed
// output is already a near-1-px skeleton, which is exactly what the
// centerline chain machinery consumes: thin the mask to clean 1-px, walk it
// into a stroke graph, condense junction clusters, prune pixel whiskers,
// then assemble smoothed sub-pixel chains (junctions paired straight-through,
// tiny loop gaps closed, drawn corners re-sharpened).

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import { cannyEdgeField, type CannyField, type CannyOptions } from './canny-edges';
import { reconnectAlongRidge } from './edge-reconnect';
import {
  assembleStrokePaths,
  buildStrokeGraph,
  condenseJunctions,
  pruneSpurs,
  squaredDistanceField,
  thinToMedialAxis,
  type InkMask,
} from './centerline';
import { medianFilter } from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';

const EDGE_COLOR = '#000000';
const DEFAULT_EDGE_MIN_LENGTH_PX = 3;
const DEFAULT_EDGE_JOIN_GAP_PX = 0;
// Canny hysteresis drops weak stretches (diagonals especially) well beyond
// the join knob; a tangent-ALIGNED continuation may bridge up to knob × this.
const EDGE_ALIGNED_JOIN_FACTOR = 3;

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  const joinGapPx = Math.max(0, options.edgeJoinGapPx ?? DEFAULT_EDGE_JOIN_GAP_PX);
  const edgeSource = medianForEdges(image, options.edgeMedianFilter);
  const field = cannyEdgeField(edgeSource, edgeCannyOptions(options));
  const mask: InkMask = { width: image.width, height: image.height, ink: field.edges };
  const polylines = chainEdgeMask(mask, options, joinGapPx, field);
  return polylines.length === 0 ? [] : [{ color: EDGE_COLOR, polylines }];
}

// Median pre-filtering: a 3×3 median protects noisy photos but DESTROYS
// clean small features — 4-6 px letters trace as melted blobs (the
// LANGEBAAN defect). Default (undefined) is therefore AUTO: apply the
// median only when the image actually contains impulse noise, measured as
// the fraction of pixels the median would change dramatically. An explicit
// true/false still forces the choice.
const IMPULSE_NOISE_LUMA_DELTA = 40;
const IMPULSE_NOISE_MIN_RATIO = 0.004;

function medianForEdges(image: RawImageData, edgeMedianFilter: boolean | undefined): RawImageData {
  if (edgeMedianFilter === false) return image;
  const filtered = medianFilter(image);
  if (edgeMedianFilter === true) return filtered;
  return impulseNoiseRatio(image, filtered) >= IMPULSE_NOISE_MIN_RATIO ? filtered : image;
}

function impulseNoiseRatio(image: RawImageData, filtered: RawImageData): number {
  const pixels = image.width * image.height;
  if (pixels === 0) return 0;
  let impulses = 0;
  for (let i = 0; i < pixels; i += 1) {
    const a = lumaAt(image, i);
    const b = lumaAt(filtered, i);
    if (Math.abs(a - b) > IMPULSE_NOISE_LUMA_DELTA) impulses += 1;
  }
  return impulses / pixels;
}

function lumaAt(image: RawImageData, i: number): number {
  return (
    0.299 * (image.data[i * 4] ?? 0) +
    0.587 * (image.data[i * 4 + 1] ?? 0) +
    0.114 * (image.data[i * 4 + 2] ?? 0)
  );
}

function edgeCannyOptions(options: TraceOptions): CannyOptions {
  return {
    ...(options.edgeBlurSigma === undefined ? {} : { blurSigma: options.edgeBlurSigma }),
    ...(options.edgeLowThresholdRatio === undefined
      ? {}
      : { lowThresholdRatio: options.edgeLowThresholdRatio }),
    ...(options.edgeHighThresholdRatio === undefined
      ? {}
      : { highThresholdRatio: options.edgeHighThresholdRatio }),
  };
}

// Ridge reconnection may walk this many pixels past a chain end, scaled from
// the join knob — soft sources (rescaled/recompressed art) drop stretches
// well beyond the knob itself.
const RIDGE_WALK_MIN_PX = 8;
const RIDGE_WALK_MAX_PX = 24;
const RIDGE_WALK_PER_JOIN_GAP = 3;

function chainEdgeMask(
  mask: InkMask,
  options: TraceOptions,
  joinGapPx: number,
  field: CannyField,
): Polyline[] {
  const distSq = squaredDistanceField(mask);
  const skeleton = thinToMedialAxis(mask, distSq);
  const graph = buildStrokeGraph(skeleton, mask.width, mask.height);
  const condensed = condenseJunctions(graph, distSq, mask.width);
  const pruned = pruneSpurs(condensed, distSq, mask.width);
  const assembled = assembleStrokePaths(pruned, distSq, mask, {
    joinGapPx,
    alignedJoinFactor: EDGE_ALIGNED_JOIN_FACTOR,
    // Canny drops pixels wherever edges MEET (junction gradients are
    // ambiguous), so ends routinely stop 1-3 px short of the line they
    // visibly join — weld them on.
    weldOpenEndsPx: Math.max(2, Math.min(6, joinGapPx)),
  });
  const maxWalkPx =
    joinGapPx <= 0
      ? 0
      : Math.min(
          RIDGE_WALK_MAX_PX,
          Math.max(RIDGE_WALK_MIN_PX, joinGapPx * RIDGE_WALK_PER_JOIN_GAP),
        );
  const reconnected = reconnectAlongRidge(
    assembled,
    {
      ridgeMag: field.ridgeMag,
      lowThreshold: field.lowThreshold,
      width: mask.width,
      height: mask.height,
    },
    maxWalkPx,
  );
  const minLengthPx = Math.max(
    Math.max(0, options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX),
    blurNoiseFloorPx(options.edgeBlurSigma),
  );
  return reconnected.filter((pl) => polylineLength(pl) >= minLengthPx && !isSliverLoop(pl));
}

// Heavy pre-blur widens gradients and breeds faint speckle chains; below a
// blur-scaled floor they are noise, not drawing. The floor is measured in
// CHAIN length: the old outline backend used sigma×10 against two-sided
// contour perimeters (≈2× chain length), so the chain-unit equivalent is
// sigma×5 — same reason the preset's edgeMinLengthPx halved 24→12.
const BLUR_NOISE_FLOOR_MIN_SIGMA = 1.5;
const BLUR_NOISE_FLOOR_PX_PER_SIGMA = 5;

function blurNoiseFloorPx(edgeBlurSigma: number | undefined): number {
  if (edgeBlurSigma === undefined || edgeBlurSigma <= 0) return 0;
  return edgeBlurSigma >= BLUR_NOISE_FLOOR_MIN_SIGMA
    ? edgeBlurSigma * BLUR_NOISE_FLOOR_PX_PER_SIGMA
    : 0;
}

// A closed loop with a long-enough perimeter but almost no enclosed area is a
// degenerate hairline lasso (double-response curl), not a drawn feature — a
// laser would burn it as a smudge. A genuine small feature (a 4-px dot's
// outline) encloses several times this.
const MAX_SLIVER_AREA_PX2 = 4;

function isSliverLoop(polyline: Polyline): boolean {
  if (!polyline.closed) return false;
  return Math.abs(signedArea(polyline.points)) <= MAX_SLIVER_AREA_PX2;
}

function signedArea(points: ReadonlyArray<Vec2>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

function polylineLength(polyline: Polyline): number {
  const points = polyline.points;
  let total = 0;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a !== undefined && b !== undefined) total += distance(a, b);
  }
  const first = points[0];
  const last = points.at(-1);
  if (polyline.closed && first !== undefined && last !== undefined) {
    total += distance(last, first);
  }
  return total;
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
