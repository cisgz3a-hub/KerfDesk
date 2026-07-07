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
  smoothRawChain,
  squaredDistanceField,
} from './centerline';
import { midCrackChain, traceBoundaryLoops } from './contour-boundary';
import { flattenStraightRuns } from './flatten-straight-runs';
import { preprocessForTrace, type RawImageData, type TraceOptions } from './trace-image';

const CONTOUR_COLOR = '#000000';
// Same base simplification epsilon as the centerline finisher; the
// TraceOptions lineTolerance contract scales it (higher = fewer vertices).
const SIMPLIFY_EPSILON_PX = 0.45;
const MIN_LOOP_POINTS = 3;
// Corner rebuild is worth its cost only on SMALL loops (glyphs, counters),
// where it restores drawn corners to ~0.01px. On big hand-drawn art
// boundaries it changes nothing measurable (arch-house IoU 0.9648 vs 0.9644)
// but its closed-ring rescans are quadratic-ish and cost seconds — above
// this dense-point count the hard-turn pinning in the evening/refine stages
// handles corners instead (~0.55px rounding, sub-pixel at engrave scale).
const SHARPEN_MAX_CHAIN_POINTS = 4096;
const NO_CORNERS: ReadonlySet<Polyline['points'][number]> = new Set();

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
  const finish: LoopFinish = {
    distSq,
    width: mask.width,
    epsilonPx: SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1),
    // The dialog's Smoothness knob doubles as wobble-flattening strength —
    // but only PAST its neutral default of 1: at 1 the flattener is off
    // (measured best on drawn art, where waviness is intentional), and the
    // slider's upper range maps to erasing up to ~2px of edge wobble for
    // rough-edged sources like screenshots and scans.
    flattenStrength: Math.max(0, ((options.smoothness ?? 1) - 1) * 6),
  };
  const polylines: Polyline[] = [];
  for (const loop of traceBoundaryLoops(mask)) {
    // Area-based speckle gate — the boundary walker sees paper holes the ink
    // despeckle never touched, so both loop polarities are filtered here.
    if (Math.abs(loop.area) < minAreaPx) continue;
    const finished = finishLoop(loop.points, finish);
    if (finished !== null) polylines.push(finished);
  }
  return polylines.length === 0 ? [] : [{ color: CONTOUR_COLOR, polylines }];
}

type LoopFinish = {
  readonly distSq: Float64Array;
  readonly width: number;
  readonly epsilonPx: number;
  readonly flattenStrength: number;
};

function finishLoop(
  staircase: ReadonlyArray<Polyline['points'][number]>,
  finish: LoopFinish,
): Polyline | null {
  const { distSq, width, epsilonPx } = finish;
  if (staircase.length < MIN_LOOP_POINTS) return null;
  // Mid-crack first (lattice steps become ≤45° bends), then the SAME raw
  // Taubin pre-smoothing the skeleton tracer applies — without it the
  // residual staircase jogs read as corners downstream and long straight
  // edges come out wobbly (maintainer-observed on the arch-house H stems).
  const dense = smoothRawChain(midCrackChain(staircase), true);
  const sharpened =
    dense.length <= SHARPEN_MAX_CHAIN_POINTS
      ? sharpenChainBends(dense, true, distSq, width)
      : { points: dense, corners: NO_CORNERS };
  const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
  const simplified = simplifyChain(evened, true, epsilonPx);
  if (simplified.length < MIN_LOOP_POINTS) return null;
  // Rough source edges leave long-wavelength waviness that survives both
  // evening and simplification (nominally straight stems trace wobbly);
  // collapse curvature-safe straight runs before the spline resample.
  const straightened = flattenStraightRuns(
    simplified,
    true,
    sharpened.corners,
    finish.flattenStrength,
  );
  if (straightened.length < MIN_LOOP_POINTS) return null;
  return {
    points: refineChainForOutput(straightened, true, sharpened.corners, epsilonPx),
    closed: true,
  };
}
