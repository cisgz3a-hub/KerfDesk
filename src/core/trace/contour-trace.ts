// Contour (filled-outline) trace backend built on the in-house centerline
// machinery — an original-code candidate replacement for the potrace-* lane
// (ADR-120 release blocker): binarize via the shared preprocessing, walk the
// ink boundary on the corner lattice (contour-boundary.ts), then finish each
// closed loop with the SAME proven stage sequence the centerline tracer uses
// (corner rebuild → curvature evening → simplify → bounded spline resample).

import type { ColoredPath, Polyline } from '../scene';
import {
  inkMaskFromPrepared,
  refineChainForOutput,
  sharpenChainBends,
  simplifyChain,
  smoothChainCurvature,
  squaredDistanceField,
} from './centerline';
import { midCrackChain, traceBoundaryLoops } from './contour-boundary';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';

const CONTOUR_COLOR = '#000000';
// Same base simplification epsilon as the centerline finisher; the
// TraceOptions lineTolerance contract scales it (higher = fewer vertices).
const SIMPLIFY_EPSILON_PX = 0.45;
const MIN_LOOP_POINTS = 3;

/** Trace filled ink regions as smooth closed outlines (holes stay hollow
 *  via even-odd filling downstream). */
export function traceImageToContourColoredPaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  const prepared = preprocessForTrace(image, options);
  const mask = inkMaskFromPrepared(prepared);
  const distSq = squaredDistanceField(mask);
  const minAreaPx = Math.max(options.ignoreLessThanPixels ?? 0, 0);
  const epsilonPx = SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1);
  const polylines: Polyline[] = [];
  for (const loop of traceBoundaryLoops(mask)) {
    // Area-based speckle gate — the boundary walker sees paper holes the ink
    // despeckle never touched, so both loop polarities are filtered here.
    if (Math.abs(loop.area) < minAreaPx) continue;
    const finished = finishLoop(loop.points, distSq, mask.width, epsilonPx);
    if (finished !== null) polylines.push(finished);
  }
  return polylines.length === 0 ? [] : [{ color: CONTOUR_COLOR, polylines }];
}

function finishLoop(
  staircase: ReadonlyArray<Polyline['points'][number]>,
  distSq: Float64Array,
  width: number,
  epsilonPx: number,
): Polyline | null {
  if (staircase.length < MIN_LOOP_POINTS) return null;
  // Mid-crack first: lattice steps become ≤45° bends, so the corner
  // sharpener and the curvature smoother see the same kind of dense chain
  // the skeleton tracer feeds them.
  const dense = midCrackChain(staircase);
  const sharpened = sharpenChainBends(dense, true, distSq, width);
  const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
  const simplified = simplifyChain(evened, true, epsilonPx);
  if (simplified.length < MIN_LOOP_POINTS) return null;
  return {
    points: refineChainForOutput(simplified, true, sharpened.corners, epsilonPx),
    closed: true,
  };
}
