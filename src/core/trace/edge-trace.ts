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
import { cannyEdges, type CannyOptions } from './canny-edges';
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
  const edgeSource = options.edgeMedianFilter === false ? image : medianFilter(image);
  const edges = cannyEdges(edgeSource, edgeCannyOptions(options));
  const mask: InkMask = { width: image.width, height: image.height, ink: edges };
  const polylines = chainEdgeMask(mask, options, joinGapPx);
  return polylines.length === 0 ? [] : [{ color: EDGE_COLOR, polylines }];
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

function chainEdgeMask(mask: InkMask, options: TraceOptions, joinGapPx: number): Polyline[] {
  const distSq = squaredDistanceField(mask);
  const skeleton = thinToMedialAxis(mask, distSq);
  const graph = buildStrokeGraph(skeleton, mask.width, mask.height);
  const condensed = condenseJunctions(graph, distSq, mask.width);
  const pruned = pruneSpurs(condensed, distSq, mask.width);
  const assembled = assembleStrokePaths(pruned, distSq, mask, {
    joinGapPx,
    alignedJoinFactor: EDGE_ALIGNED_JOIN_FACTOR,
  });
  const minLengthPx = Math.max(
    Math.max(0, options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX),
    blurNoiseFloorPx(options.edgeBlurSigma),
  );
  return assembled.filter((pl) => polylineLength(pl) >= minLengthPx && !isSliverLoop(pl));
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
