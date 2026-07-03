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
import { filledInkSupportBitmap } from './edge-ink-support';
import { makeRidgeSnapper } from './edge-subpixel';
import { snapCornersToInk } from './potrace-apex';
import {
  assembleStrokePaths,
  buildStrokeGraph,
  closePolylineLoops,
  closeRingEndpoints,
  condenseJunctions,
  LOOP_TOUCH_GAP_PX,
  pruneSpurs,
  squaredDistanceField,
  thinToMedialAxis,
  type InkMask,
  type LoopClosureOptions,
} from './centerline';
import { impulseNoiseRatio, IMPULSE_NOISE_MIN_RATIO, medianFilter } from './preprocess';
import type { RawImageData, TraceOptions } from './trace-image';

const EDGE_COLOR = '#000000';
const DEFAULT_EDGE_MIN_LENGTH_PX = 3;
const DEFAULT_EDGE_JOIN_GAP_PX = 0;
// Apex snapping recovers blunted convex tips only on rings this long or longer.
// Edge Detection also traces SMALL TEXT (LANGEBAAN glyphs ~30-185px perimeter),
// which the Canny+ridge path already localises well; snapping their crowded
// corners just re-facets them. A genuine large silhouette (a 12-tip star traces
// as one ~900px ring) clears this comfortably, so recovery stays confined to
// real tips. Smooth curves have no qualifying corners and are unaffected either
// way, so this only gates which SHARP features get recovered.
const APEX_SNAP_MIN_RING_PERIMETER_PX = 250;
// Canny hysteresis drops weak stretches (diagonals especially) well beyond
// the join knob; a tangent-ALIGNED continuation may bridge up to knob × this.
const EDGE_ALIGNED_JOIN_FACTOR = 3;

export function traceImageToEdgePaths(image: RawImageData, options: TraceOptions): ColoredPath[] {
  const joinGapPx = Math.max(0, options.edgeJoinGapPx ?? DEFAULT_EDGE_JOIN_GAP_PX);
  const edgeSource = medianForEdges(image, options.edgeMedianFilter);
  const field = cannyEdgeField(edgeSource, edgeCannyOptions(options));
  const mask: InkMask = { width: image.width, height: image.height, ink: field.edges };
  const rings = chainEdgeMask(mask, options, joinGapPx, field);
  // Edge traces the SILHOUETTE, so a closed ring's acute convex tips are genuine
  // drawn points. Canny + thinning blunt them ~2px short (the tip pixel is the
  // last ink cell), so — like Line Art — reconstruct each tip by extending its
  // two flanks to their intersection, guarded outward by the FILLED source
  // silhouette (Edge's own edge map is a hairline and would reject every move).
  // The perimeter floor confines recovery to genuine large silhouettes: unlike
  // potrace (well-separated glyph contours), Edge also traces small text whose
  // crowded corners the Canny+ridge path already localises, so snapping them
  // just re-facets — the floor leaves them as traced. Snap BEFORE endpoint
  // closure so a moved tip that IS a ring's start point still closes coincident.
  const snapped = snapCornersToInk(rings, filledInkSupportBitmap(image), {
    minRingPerimeterPx: APEX_SNAP_MIN_RING_PERIMETER_PX,
  });
  const polylines = closeRingEndpoints(snapped);
  return polylines.length === 0 ? [] : [{ color: EDGE_COLOR, polylines }];
}

// Median pre-filtering: a 3×3 median protects noisy photos but DESTROYS
// clean small features — 4-6 px letters trace as melted blobs (the
// LANGEBAAN defect). Default (undefined) is therefore AUTO: apply the
// median only when the image actually contains impulse noise (see
// hasImpulseNoise in preprocess.ts, which owns the shared detector and its
// constants). An explicit true/false still forces the choice.
//
// The auto branch reuses the median it already computed rather than calling
// hasImpulseNoise (which would filter a second time).
function medianForEdges(image: RawImageData, edgeMedianFilter: boolean | undefined): RawImageData {
  if (edgeMedianFilter === false) return image;
  const filtered = medianFilter(image);
  if (edgeMedianFilter === true) return filtered;
  return impulseNoiseRatio(image, filtered) >= IMPULSE_NOISE_MIN_RATIO ? filtered : image;
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
    // The binary mask localises edges to whole pixels; the Sobel ridge
    // localises them to sub-pixel. Snap raw vertices onto the ridge so
    // curves come out smooth instead of staircase-lumpy.
    snapPoint: makeRidgeSnapper({
      gradMag: field.gradMag,
      gradX: field.gradX,
      gradY: field.gradY,
      width: mask.width,
      height: mask.height,
    }),
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
  // Ridge reconnection merges chains; a merged ring whose ends meet at a
  // drawn corner can only close NOW (the walk's tangent cone cannot turn a
  // corner, so it never self-closes there).
  const closure: LoopClosureOptions = {
    touchGapPx: LOOP_TOUCH_GAP_PX,
    cornerGapPx: Math.max(LOOP_TOUCH_GAP_PX, joinGapPx),
    alignedGapPx: Math.max(LOOP_TOUCH_GAP_PX, joinGapPx * EDGE_ALIGNED_JOIN_FACTOR),
  };
  const looped = closePolylineLoops(reconnected, closure);
  const minLengthPx = Math.max(
    Math.max(0, options.edgeMinLengthPx ?? DEFAULT_EDGE_MIN_LENGTH_PX),
    blurNoiseFloorPx(options.edgeBlurSigma),
  );
  // Returns the filtered rings WITHOUT endpoint closure: the caller snaps convex
  // tips outward first (a moved tip may be a ring's start point), then runs
  // closeRingEndpoints so every ring returns to its — possibly moved — start.
  return looped.filter(
    (pl) =>
      (polylineLength(pl) >= minLengthPx || isWeldedConnector(pl, looped)) && !isSliverLoop(pl),
  );
}

// A short OPEN chain whose both ends sit ON other geometry is a weld
// connector patching a detection dropout between two lines — dropping it as
// "too short" would reopen the very gap the weld closed. Everything else
// under the minimum length is debris.
const CONNECTOR_TOUCH_PX = 1.0;

function isWeldedConnector(polyline: Polyline, all: ReadonlyArray<Polyline>): boolean {
  if (polyline.closed || polyline.points.length < 2) return false;
  const first = polyline.points[0];
  const last = polyline.points.at(-1);
  if (first === undefined || last === undefined) return false;
  return touchesOtherGeometry(first, polyline, all) && touchesOtherGeometry(last, polyline, all);
}

function touchesOtherGeometry(p: Vec2, own: Polyline, all: ReadonlyArray<Polyline>): boolean {
  for (const other of all) {
    if (other === own || other.points.length < 2) continue;
    const count = other.points.length + (other.closed ? 0 : -1);
    for (let i = 0; i < count; i += 1) {
      const a = other.points[i];
      const b = other.points[(i + 1) % other.points.length];
      if (a === undefined || b === undefined) continue;
      if (pointToSegmentDistance(p, a, b) <= CONNECTOR_TOUCH_PX) return true;
    }
  }
  return false;
}

function pointToSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
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
