// Contour (filled-outline) trace backend built on the in-house centerline
// machinery — the adopted backend for every binary filled preset (Line Art,
// Smooth, Sharp) and, via its shared finisher, Edge Detection. It replaced
// the GPL-provenance potrace-derived backend (ADR-123, closing the ADR-120
// MIT-release blocker): binarize via the shared preprocessing, walk the ink
// boundary on the corner lattice (contour-boundary.ts), then finish each
// closed loop with the SAME proven stage sequence the centerline tracer uses
// (corner rebuild → curvature evening → arc/line evening → simplify →
// bounded spline resample).

import type { ColoredPath, Polyline } from '../scene';
import {
  closeRingEndpoints,
  inkMaskFromPrepared,
  refineChainForOutput,
  sharpenChainBends,
  simplifyChain,
  smoothChainCurvature,
  smoothRawChain,
  squaredDistanceField,
  type InkMask,
} from './centerline';
import { midCrackChain, traceBoundaryLoops, type CrackSubPixelField } from './contour-boundary';
import { flattenStraightRuns } from './flatten-straight-runs';
import { smoothArcNoise } from './smooth-arc-noise';
import {
  crackFieldForTrace,
  preprocessForTrace,
  type RawImageData,
  type TraceOptions,
} from './trace-image';

const CONTOUR_COLOR = '#000000';

/** True for the binary filled-contour presets (Line Art, Smooth, Sharp):
 *  non-centerline, 2-colour, fixed 2-entry palette. These route to this
 *  in-house contour backend; everything else falls through to the
 *  centerline/edge tracers or the imagetracerjs multi-colour path. This is
 *  the permanent dispatch predicate that replaced the temporary potrace A/B
 *  gate (ADR-123). */
export function isBinaryContourPreset(options: TraceOptions): boolean {
  if (options.traceMode === 'centerline' || options.traceMode === 'edge') return false;
  if (options.numberOfColors !== 2) return false;
  return options.fixedPalette?.length === 2;
}
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
// ...and NOT worth its risk on TINY loops (glyph-scale letters): the bend
// window's arm is comparable to the whole feature there, so the rebuild
// pins false corners on round bowls and the spline renders them as
// polygons (the melted LANGEBAAN "B", 12-15 pinned corners on one ~30px
// letter). Below this dense-point count the sparse-stage hard-turn
// detection (≥60° in curve-refine/chain-smoothing) owns the corners:
// genuine stem corners still break the spline, bowls stay round.
const SHARPEN_MIN_CHAIN_POINTS = 260;
const NO_CORNERS: ReadonlySet<Polyline['points'][number]> = new Set();
// Neutral Smoothness when the dialog value is absent or non-finite.
const DEFAULT_SMOOTHNESS = 1;

/** The dialog's Smoothness knob doubles as the wobble-flattening / arc-
 *  evening strength. Default ON at the conservative 1px amplitude cap — the
 *  earlier default-off mapping left nominally straight stems visibly wobbly
 *  on thresholded real sources (maintainer verdict, 2026-07-07). The
 *  max(0, 6s − 5) ramp keeps Sharp's 0.55 (anything ≤ ~0.83) fully off for
 *  pixel-fidelity work, reaches the 1px baseline at the neutral default 1,
 *  and scales to ~3px erase at the slider max 1.33 for rough screenshots and
 *  scans. Drawn waves above the amplitude cap are never touched (see the
 *  oscillation gate in flatten-straight-runs.ts). A non-finite Smoothness
 *  falls back to the default rather than yielding NaN — NaN would silently
 *  disable BOTH amplitude caps downstream instead of clamping to 0. */
export function flattenStrengthFromSmoothness(smoothness: number | undefined): number {
  const s = Number.isFinite(smoothness) ? (smoothness as number) : DEFAULT_SMOOTHNESS;
  return Math.max(0, 6 * s - 5);
}

/** Trace filled ink regions as smooth closed outlines (holes stay hollow
 *  via even-odd filling downstream). */
export function traceImageToContourColoredPaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  const prepared = preprocessForTrace(image, options);
  const mask = inkMaskFromPrepared(prepared);
  // Sub-pixel crack interpolation: vertex POSITIONS come from the
  // pre-threshold scalar field while loop TOPOLOGY stays on the cleaned
  // binary mask (despeckle / pinhole fill decide what exists; the AA ramp
  // decides exactly where its edge lies).
  const crackField = crackFieldForTrace(image, options);
  const polylines = contourPolylinesFromMask(mask, {
    minAreaPx: Math.max(options.ignoreLessThanPixels ?? 0, 0),
    epsilonPx: SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1),
    flattenStrength: flattenStrengthFromSmoothness(options.smoothness),
    ...(crackField === null ? {} : { crackField }),
  });
  return polylines.length === 0 ? [] : [{ color: CONTOUR_COLOR, polylines }];
}

export type ContourFinishOptions = {
  /** Loops (either polarity) below this area in px² are dropped. */
  readonly minAreaPx: number;
  /** Douglas-Peucker tolerance and spline deviation cap, px. */
  readonly epsilonPx: number;
  /** Wobble-flattening strength (see flatten-straight-runs.ts); 0 = off. */
  readonly flattenStrength: number;
  /** Pre-threshold field for sub-pixel crack interpolation; omitted = plain
   *  mid-crack vertices (binary-only callers like the edge lane). */
  readonly crackField?: CrackSubPixelField;
};

/** Finish a binary ink mask into smooth closed outlines — the shared
 *  geometry stage behind the filled-contours lane and (via its own mask
 *  builder) the Edge Detection lane. */
export function contourPolylinesFromMask(mask: InkMask, options: ContourFinishOptions): Polyline[] {
  const finish: LoopFinish = {
    distSq: squaredDistanceField(mask),
    width: mask.width,
    epsilonPx: options.epsilonPx,
    flattenStrength: options.flattenStrength,
    crackField: options.crackField,
  };
  const polylines: Polyline[] = [];
  for (const loop of traceBoundaryLoops(mask)) {
    // Area-based speckle gate — the boundary walker sees paper holes the ink
    // despeckle never touched, so both loop polarities are filtered here.
    if (Math.abs(loop.area) < options.minAreaPx) continue;
    const finished = finishLoop(loop.points, finish);
    if (finished !== null) polylines.push(finished);
  }
  return polylines;
}

type LoopFinish = {
  readonly distSq: Float64Array;
  readonly width: number;
  readonly epsilonPx: number;
  readonly flattenStrength: number;
  readonly crackField: CrackSubPixelField | undefined;
};

function finishLoop(
  staircase: ReadonlyArray<Polyline['points'][number]>,
  finish: LoopFinish,
): Polyline | null {
  const { distSq, width, epsilonPx } = finish;
  if (staircase.length < MIN_LOOP_POINTS) return null;
  // Mid-crack first (lattice steps become ≤45° bends; sub-pixel interpolated
  // when the pre-threshold field is available), then the SAME raw Taubin
  // pre-smoothing the skeleton tracer applies — without it the residual
  // staircase jogs read as corners downstream and long straight edges come
  // out wobbly (maintainer-observed on the arch-house H stems).
  const dense = smoothRawChain(midCrackChain(staircase, finish.crackField), true);
  const sharpened =
    dense.length >= SHARPEN_MIN_CHAIN_POINTS && dense.length <= SHARPEN_MAX_CHAIN_POINTS
      ? sharpenChainBends(dense, true, distSq, width)
      : { points: dense, corners: NO_CORNERS };
  const evened = smoothChainCurvature(sharpened.points, true, sharpened.corners);
  // Mid-wavelength curvature noise (the "small wobble in the O") is evened
  // on the DENSE chain, where a local moving circle fit has rich statistics
  // and cannot average away drawn structure the way long-span fits do
  // (measured: run-level arc replacement cost 10 IoU points on real art).
  // LARGE loops only — the same size class as the corner rebuild: glyph
  // bowls at counter scale already render correctly and a ±7px window is a
  // large fraction of such a feature.
  const arcSmoothed =
    dense.length >= SHARPEN_MIN_CHAIN_POINTS
      ? smoothArcNoise(evened, true, sharpened.corners, finish.flattenStrength)
      : evened;
  const simplified = simplifyChain(arcSmoothed, true, epsilonPx);
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
  // Closed rings must RETURN to their start point (ADR-100 third amendment):
  // renderers and emitters draw points as given and never synthesise the
  // closing edge, so a ring left "open" engraves with a seam gap.
  const closed = closeRingEndpoints([
    {
      points: refineChainForOutput(straightened, true, sharpened.corners, epsilonPx),
      closed: true,
    },
  ]);
  return closed[0] ?? null;
}
