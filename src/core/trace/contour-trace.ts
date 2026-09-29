// Contour (filled-outline) trace backend built on the in-house centerline
// machinery — the adopted backend for every binary filled preset (Line Art,
// Smooth, Sharp) and, via its shared finisher, Edge Detection. It replaced
// the GPL-provenance potrace-derived backend (ADR-123, closing the ADR-120
// MIT-release blocker): binarize via the shared preprocessing, walk the ink
// boundary on the corner lattice (contour-boundary.ts), then finish each
// closed loop (corner dial → curvature evening → arc/line evening), and end
// every loop in the compact fit (compact-curve-fit.ts, ADR-530): the fewest
// cubics and lines within a tolerance, carried as the ring's canonical
// curve. Measured loops are fitted directly; binary loops keep the
// centerline's simplify + bounded spline resample as the shape they fit.

import type { ColoredPath, Polyline, Vec2 } from '../scene';
import {
  inkMaskFromPrepared,
  simplifyChain,
  smoothChainCurvature,
  type InkMask,
} from './centerline';
import { runTraceSteps, type TraceSteps } from './trace-steps';
import {
  midCrackChainWithStats,
  traceBoundaryLoops,
  type BoundaryLoop,
  type CrackSubPixelField,
} from './contour-boundary';
import { fairChainSegments } from './fair-chain';
import {
  CONNECT_PAPER_AT_SADDLES,
  createSaddleResolver,
  normalizeTurnPolicy,
  type TurnPolicy,
} from './saddle-connectivity';
import { fitCompactRing, sampleCompactCurve } from './compact-curve-fit';
import { collectOutputCorners } from './centerline/curve-refine';
import { fitSmoothCurve } from './centerline/curve-fit';
import { denseChordBand } from './contour-chord-band';
import { flattenStraightRuns } from './flatten-straight-runs';
import { isSaddleVertex, smoothBetweenCorners } from './contour-loop-shape';
import { smoothArcNoise } from './smooth-arc-noise';
import { curvedTraceRing } from './trace-curves';
import {
  keptForest,
  latticeLoopParents,
  nestedContourPath,
  type NestedContourRings,
} from './contour-nesting';
import { optimizationToleranceScaleFromOptimize } from './trace-optimize';
import { contourFeatureAnchors } from './contour-feature-anchors';
import {
  chainWithCorners,
  cornerThresholdFromSmoothness,
  decideContourCorners,
  separateSaddleApexes,
  type CornerChain,
} from './contour-corners';
import { ADMITTED_LOOP_MIN_POINTS, admittedLoopFallback } from './admitted-loop-simplify';
import { contourTraceInputMatches, type ContourTraceInput } from './contour-input';
import {
  closeContour,
  preserveContourTopologySteps,
  type ContourRefinement,
  type FinishedContour,
} from './contour-topology';
import {
  effectivePixelScale,
  prepareTraceForContour,
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
  if (options.photoDetail !== undefined) return false;
  // Line + fill (ADR-454) is also 2-colour with a fixed palette, but its
  // strokes carry widths and its gate is in pixels: the contour-only routes
  // (supersample profile, dense-colour downscale) would drop both.
  if (
    options.traceMode === 'centerline' ||
    options.traceMode === 'edge' ||
    options.traceMode === 'hybrid'
  ) {
    return false;
  }
  if (options.numberOfColors !== 2) return false;
  return options.fixedPalette?.length === 2;
}
// Same base simplification epsilon as the centerline finisher; the
// TraceOptions lineTolerance contract scales it (higher = fewer vertices).
const SIMPLIFY_EPSILON_PX = 0.45;
const MIN_LOOP_POINTS = ADMITTED_LOOP_MIN_POINTS;
// Loop size class for the dense arc-noise evening (corners are decided for
// every loop by the corner dial, contour-corners.ts). Loops from this many
// chain points up are big enough for it; on glyph-scale loops below it the
// ±7px evening window would be a large fraction of the feature.
const ARC_EVENING_MIN_CHAIN_POINTS = 260;
// Measured loops above this size are organic art boundaries: Whittaker-faired
// between their corners before the looser organic fit.
const ORGANIC_MIN_CHAIN_POINTS = 4096;
const NO_CORNERS: ReadonlySet<Polyline['points'][number]> = new Set();
// A loop whose cracks mostly interpolated is a sub-pixel MEASUREMENT (see
// finishLoop): above this fraction the wobble stages disable for that loop.
const SUBPIXEL_INFORMED_FRACTION = 0.3;
// Compact-fit tolerance (compact-curve-fit.ts, ADR-530): the largest
// ORTHOGONAL distance of the output curve from the chain it fits, in SOURCE px
// (scaled by pixelScale like every px knob), at Optimize's neutral 0.2. ~2-3x
// the sub-pixel measurement noise: tight enough to keep drawn features, loose
// enough that the fit averages noise instead of chasing it. At 0.35 the
// merge fitted a radius-17 disc with two half-circle cubics, 0.33 px off the
// round; at 0.25 it takes three or four.
const FIT_TOLERANCE_PX = 0.25;
// Above-range (organic art) loops are Whittaker-faired BEFORE fitting
// (fair-chain.ts, research brief #3): the penalized smoother removes ~94%
// of the ink texture in one banded solve, so the fit sees ~0.1-0.2px
// residual noise and this tolerance (~3x that) physically cannot trigger
// texture-chasing error splits. Tolerance-based fairing was tried twice and
// still sawed — splitting on max error chases any bump above tolerance.
const FIT_TOLERANCE_ORGANIC_PX = 0.55;
// The Optimize scale at Optimize 0 (the smallest final tolerance).
const MIN_OPTIMIZE_TOLERANCE_SCALE = optimizationToleranceScaleFromOptimize(0);
// Candidate joints come from a fit this much tighter than that tolerance, so
// the merge has a choice of joints to keep.
const CANDIDATE_TOLERANCE_SHARE = 0.75;
// Joint tangents of the compact fit are estimated over this arc, source px.
const TANGENT_WINDOW_PX = 2;
// The topology repair refits a ring at no less than this share of its
// tolerance; a weaker step takes the ring's baseline instead (ADR-530,
// Amendment 8). Below a quarter a refit mostly chases the chain's own noise
// and rarely clears the conflict, and each costs a whole fit of the ring.
const MIN_REFIT_AMOUNT = 0.25;
// Spline samples inside each simplified edge of the binary tail's resample
// (the count the centreline refine step uses).
const SPLINE_SAMPLES_PER_SEGMENT = 3;
// Neutral Smoothness when the dialog value is absent or non-finite.
const DEFAULT_SMOOTHNESS = 1;

/** Smoothness drives two things: the corner dial (which turns are corners,
 *  {@link cornerThresholdFromSmoothness}) and this edge-denoise strength for
 *  the straight-run flattener and arc-noise evening. Default ON at the conservative 1px amplitude cap — the
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

/** Optimize scales geometry tolerances around the established neutral 0.2
 *  (shared with the edge and centerline finishers). */
export { optimizationToleranceScaleFromOptimize };

/** Trace filled ink regions as smooth closed outlines (holes stay hollow
 *  via even-odd filling downstream). */
export function traceImageToContourColoredPaths(
  image: RawImageData,
  options: TraceOptions,
): ColoredPath[] {
  return runTraceSteps(traceImageToContourColoredPathsSteps(image, options));
}

export function* traceImageToContourColoredPathsSteps(
  image: RawImageData,
  options: TraceOptions,
  preparedInput?: ContourTraceInput,
): TraceSteps<ColoredPath[]> {
  const cooperate = yield;
  const { prepared, crackField } =
    preparedInput !== undefined && contourTraceInputMatches(preparedInput, image, options)
      ? preparedInput
      : prepareTraceForContour(image, options);
  if (cooperate) yield;
  const mask = inkMaskFromPrepared(prepared);
  // Sub-pixel crack interpolation: vertex POSITIONS come from the
  // pre-threshold scalar field while loop TOPOLOGY stays on the cleaned
  // binary mask (despeckle / pinhole fill decide what exists; the AA ramp
  // decides exactly where its edge lies).
  // Pixel-denominated knobs keep SOURCE-pixel semantics on a supersampled
  // trace: areas scale by scale², lengths (simplify ε) by scale.
  const rings = yield* contourRingsFromMaskSteps(mask, {
    ...contourFinishOptionsFor(options),
    ...(crackField === null ? {} : { crackField }),
  });
  return rings.polylines.length === 0 ? [] : [nestedContourPath(CONTOUR_COLOR, rings)];
}

/** The outline finish a trace's options ask for, less the crack field.
 *  Pixel-denominated knobs keep SOURCE-pixel semantics on a supersampled
 *  trace: areas scale by scale^2, lengths (simplify epsilon) by scale. Shared
 *  with the Line + fill lane, which finishes its fill mask the same way. */
export function contourFinishOptionsFor(options: TraceOptions): ContourFinishOptions {
  const scale = effectivePixelScale(options);
  const toleranceScale = optimizationToleranceScaleFromOptimize(options.optimize);
  return {
    minAreaPx: Math.max(options.ignoreLessThanPixels ?? 0, 0) * scale * scale,
    epsilonPx:
      SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1) * scale * toleranceScale,
    fitToleranceScale: toleranceScale,
    flattenStrength: flattenStrengthFromSmoothness(options.smoothness),
    cornerThresholdPx: cornerThresholdFromSmoothness(options.smoothness),
    pixelScale: scale,
    turnPolicy: normalizeTurnPolicy(options.turnPolicy),
  };
}

export type ContourFinishOptions = {
  /** Loops (either polarity) below this area in px² are dropped. */
  readonly minAreaPx: number;
  /** Douglas-Peucker tolerance and spline deviation cap, px. */
  readonly epsilonPx: number;
  /** Edge-denoise strength (see flatten-straight-runs.ts); 0 = off. */
  readonly flattenStrength: number;
  /** Corner-dial threshold in source px (contour-corners.ts); omitted = the
   *  neutral Smoothness 1. */
  readonly cornerThresholdPx?: number;
  readonly fitToleranceScale?: number;
  /** Supersampling factor of the mask; scales every px knob and the
   *  chain-length size classes so glyphs stay in the class they were tuned in. */
  readonly pixelScale?: number;
  /** Pre-threshold field for sub-pixel crack interpolation; omitted = plain
   *  mid-crack vertices (binary-only callers like the edge lane). */
  readonly crackField?: CrackSubPixelField;
  /** Saddle policy (ADR-403), matching the one the mask cleanup used.
   *  Omitted = the historical rule (ink four-connected), as the edge lane. */
  readonly turnPolicy?: TurnPolicy;
};

/** Finish a binary ink mask into smooth closed outlines — the shared
 *  geometry stage behind the filled-contours lane and (via its own mask
 *  builder) the Edge Detection lane. */
export function contourPolylinesFromMask(mask: InkMask, options: ContourFinishOptions): Polyline[] {
  return runTraceSteps(contourPolylinesFromMaskSteps(mask, options));
}

export function* contourPolylinesFromMaskSteps(
  mask: InkMask,
  options: ContourFinishOptions,
): TraceSteps<Polyline[]> {
  return [...(yield* contourRingsFromMaskSteps(mask, options)).polylines];
}

/** The finished outlines in boundary scan order, with their containment forest
 *  from the raw lattice loops (contour-nesting.ts, ADR-531). */
export function* contourRingsFromMaskSteps(
  mask: InkMask,
  options: ContourFinishOptions,
): TraceSteps<NestedContourRings> {
  const cooperate = yield;
  const pixelScale =
    options.pixelScale !== undefined && Number.isFinite(options.pixelScale)
      ? Math.max(1, options.pixelScale)
      : 1;
  const finish: LoopFinish = {
    mask,
    epsilonPx: options.epsilonPx,
    flattenStrength: options.flattenStrength,
    cornerThresholdPx: options.cornerThresholdPx ?? cornerThresholdFromSmoothness(undefined),
    fitToleranceScale: options.fitToleranceScale ?? 1,
    pixelScale,
    crackField: options.crackField,
  };
  const contours: FinishedContour[] = [];
  const saddles =
    options.turnPolicy === undefined
      ? CONNECT_PAPER_AT_SADDLES
      : createSaddleResolver(mask, options.turnPolicy, options.crackField, pixelScale);
  const loops = traceBoundaryLoops(mask, saddles);
  // Exact containment on the lattice, before any vertex moves.
  const parents = latticeLoopParents(loops);
  const kept: number[] = [];
  for (const [index, loop] of loops.entries()) {
    if (cooperate) yield;
    // Area-based speckle gate — the boundary walker sees paper holes the ink
    // despeckle never touched, so both loop polarities are filtered here.
    if (!isAdmittedLoop(loop, options.minAreaPx)) continue;
    // No-orphan invariant (ADR-536 amendment 1): finishing and topology
    // repair return exactly one ring per admitted loop, with its source
    // orientation and nesting, so a hole never outlives its outer.
    contours.push(finishLoop(loop.points, finish));
    kept.push(index);
  }
  const polylines = yield* preserveContourTopologySteps(contours);
  return { polylines, parents: parents === null ? null : keptForest(parents, kept) };
}

/** The area policy for boundary loops. A loop that encloses nothing is never
 *  admitted. Enclosed area shrinks strictly down the nesting (a loop's area
 *  includes everything inside it), so this rule drops a loop only together
 *  with every loop nested inside it (ADR-536 amendment 1). */
export function isAdmittedLoop(loop: BoundaryLoop, minAreaPx: number): boolean {
  const area = Math.abs(loop.area);
  return area > 0 && area >= minAreaPx;
}

type LoopFinish = {
  readonly mask: InkMask;
  readonly epsilonPx: number;
  readonly flattenStrength: number;
  readonly cornerThresholdPx: number;
  readonly fitToleranceScale: number;
  readonly pixelScale: number;
  readonly crackField: CrackSubPixelField | undefined;
};

function featureAnchorsForLoop(
  staircase: ReadonlyArray<Polyline['points'][number]>,
  dense: ReadonlyArray<Polyline['points'][number]>,
  finish: LoopFinish,
  subPixelInformed: boolean,
): ReadonlySet<Polyline['points'][number]> {
  return finish.flattenStrength === 0 && !subPixelInformed
    ? contourFeatureAnchors(staircase, dense, finish.mask)
    : NO_CORNERS;
}

function finishLoop(staircase: ReadonlyArray<Vec2>, finish: LoopFinish): FinishedContour {
  // Mid-crack first (lattice steps become ≤45° bends; sub-pixel interpolated
  // when the pre-threshold field is available).
  const crack = midCrackChainWithStats(staircase, finish.crackField);
  // The wobble stages (straight-run flattener, arc-noise evening) are
  // quantization-noise medicine. When most cracks carried real sub-pixel
  // information, the boundary is a MEASUREMENT — chord-replacing it
  // fabricates joint steps on gently flaring stems (maintainer H-stem
  // verdicts, 2026-07-11) and evening it fights drawn texture. Binary
  // sources (saturated steps, fraction ~0) keep the full 1x behaviour.
  const subPixelInformed = crack.interpolatedFraction >= SUBPIXEL_INFORMED_FRACTION;
  // The corner dial decides every corner of the loop on the RAW cracks,
  // before any smoothing can round them, and splices each apex in exactly.
  const decided = decideContourCorners({
    staircase,
    cracks: crack.points,
    measured: subPixelInformed,
    pixelScale: finish.pixelScale,
    thresholdPx: finish.cornerThresholdPx,
    // The straight-run flattener erases wobble up to 1px × strength; apexes
    // sit on the lines it will draw (binary loops only — measured loops skip it).
    edgeNoisePx: subPixelInformed ? 0 : finish.flattenStrength,
    ...(finish.crackField === undefined ? {} : { field: finish.crackField }),
  });
  const corners = separateSaddleApexes(decided, crack.points, (vertex) =>
    isSaddleVertex(finish.mask, vertex),
  );
  const spliced = chainWithCorners(crack.points, corners);
  // The area policy has already admitted this boundary. A tolerance larger
  // than the loop can collapse the finishing tail to two anchors; Optimize
  // must not become another area-removal control. Retain the measured crack
  // boundary in that case as a compact outline (ADR-536: one bounded
  // fallback, no new fitting search), and include it in the same topology
  // repair as every other admitted contour.
  const retainCracks = (): ContourRefinement =>
    admittedLoopFallback(crack.points, finish.epsilonPx);
  const retained = finishDenseLoop(staircase, spliced, subPixelInformed, finish) ?? retainCracks();
  const source = closeContour(crack.points);
  if (spliced.corners.size === 0) return { ...retained, source };
  // A corner apex extends the legs to where they meet, bounded by the corner
  // itself, not by neighbouring outlines, so on dense art it is the usual
  // reason a finished loop crosses a neighbour. The topology repair tries
  // this finish without corners, with full smoothing, before it backs the
  // smoothing off.
  return {
    ...retained,
    source,
    withoutRebuiltCorners: () =>
      finishDenseLoop(staircase, chainWithCorners(crack.points, []), subPixelInformed, finish) ??
      retainCracks(),
  };
}

// Smooth the spliced chain between its corners, then run the size-class tail.
// Null when the tail collapses the loop (the caller retains the cracks).
function finishDenseLoop(
  staircase: ReadonlyArray<Vec2>,
  spliced: CornerChain,
  subPixelInformed: boolean,
  finish: LoopFinish,
): ContourRefinement | null {
  const corners = spliced.corners;
  // The same raw Taubin pre-smoothing the skeleton tracer applies — without it
  // the residual staircase jogs read as corners downstream and long straight
  // edges come out wobbly (maintainer-observed on the arch-house H stems) —
  // run span by span so every corner apex stays exactly where it was decided.
  const dense = smoothBetweenCorners(spliced.points, corners);
  // When quantization smoothing is off, a terminal pixel is deliberate
  // detail. Keep its cap through simplification. The pins are existing
  // pre-smoothed points, so the spline can still round them; they are not
  // drawn corners. Measured AA loops keep their own tail.
  const aligned = Array.from(spliced.crackIndex, (index) => dense[index] as Vec2);
  const featureAnchors = featureAnchorsForLoop(staircase, aligned, finish, subPixelInformed);
  // The size classes were tuned at 1x; a supersampled chain is pixelScale×
  // denser, so the bounds scale with it — a LANGEBAAN-size glyph must stay in
  // the class it was tuned for.
  const arcMin = ARC_EVENING_MIN_CHAIN_POINTS * finish.pixelScale;
  const organicMin = ORGANIC_MIN_CHAIN_POINTS * finish.pixelScale;
  // Measured loops skip the denoise stages entirely: the chord flattener
  // fabricates joint steps on measured stems, and organic loops get the
  // principled Whittaker fairing instead of the arc-noise evening.
  const denoiseStrength = subPixelInformed ? 0 : finish.flattenStrength;
  const pinned = featureAnchors.size === 0 ? corners : new Set([...corners, ...featureAnchors]);
  const evened = smoothChainCurvature(dense, true, pinned);
  // Mid-wavelength curvature noise (the "small wobble in the O") is evened on
  // the DENSE chain, where a local moving circle fit has rich statistics and
  // cannot average away drawn structure the way long-span fits do (measured:
  // run-level arc replacement cost 10 IoU points on real art). LARGE loops
  // only: glyph bowls at counter scale already render correctly and a ±7px
  // window is a large fraction of such a feature.
  const arcSmoothed =
    dense.length >= arcMin
      ? smoothArcNoise(evened, true, corners, denoiseStrength, finish.pixelScale)
      : evened;
  // Measured loops take the fairing-by-fitting tail at EVERY size: the
  // compact fit THROUGH the measured points averages ~0.1px noise into fair
  // curves (research brief #2). The simplify + spline tail it replaced bowed
  // every straight edge outward (its spline passed through Douglas-Peucker
  // vertices and a cap of ±ε let it sit ~0.3 px outside the ink): a thin AA
  // bar gained up to 24% area (ADR-530). Organic-size loops are
  // Whittaker-faired between their corners first.
  if (subPixelInformed) {
    return dense.length > organicMin
      ? fitLoopTail(
          fairChainSegments(arcSmoothed, true, corners, finish.pixelScale),
          corners,
          finish,
          FIT_TOLERANCE_ORGANIC_PX,
        )
      : fitLoopTail(arcSmoothed, corners, finish, FIT_TOLERANCE_PX);
  }
  return finishLegacyLoop(arcSmoothed, corners, denoiseStrength, finish, featureAnchors);
}

// The binary tail (saturated / pixel-fidelity sources): straight-run flatten
// → simplify → flatten → corner-aware spline resample, as tuned for binary
// art, then the compact fit THROUGH that resample (ADR-530): the shape stays
// the approved one, the output becomes a few cubics between its corners and
// single lines along its straight runs. The shape stages run at Optimize's
// neutral ε, so Optimize is only the final fit tolerance and the segment
// count cannot rise with it.
function finishLegacyLoop(
  arcSmoothed: ReadonlyArray<Polyline['points'][number]>,
  corners: ReadonlySet<Polyline['points'][number]>,
  flattenStrength: number,
  finish: LoopFinish,
  featureAnchors: ReadonlySet<Polyline['points'][number]>,
): ContourRefinement | null {
  // Rough source edges leave long-wavelength waviness that survives evening
  // (nominally straight stems trace wobbly); collapse curvature-safe straight
  // runs. On a loop with corners (a polygon or glyph outline, whose edges
  // between corners are the straight-run hypothesis) first on the DENSE
  // chain, where a run's fit sees every sample — Douglas-Peucker keeps
  // exactly the wobble extremes, so a run fitted only through them is biased
  // and breaks on its own outliers (measured on an 18-bar jittered sweep:
  // mean edge RMS 0.33 → 0.15 px). A corner-free loop is a closed curve,
  // where every dense secant risks faceting it; it skips that pass. Then once
  // more on the simplified chain, whose longer vertex spacing lets runs
  // bridge what the dense pass left.
  const flattened =
    corners.size === 0
      ? arcSmoothed
      : flattenStraightRuns(arcSmoothed, true, corners, flattenStrength, finish.pixelScale);
  const epsilon = finish.epsilonPx / finish.fitToleranceScale;
  // Corners and feature anchors survive simplification by reference.
  const pinned = featureAnchors.size === 0 ? corners : new Set([...corners, ...featureAnchors]);
  const simplified = simplifyChain(flattened, true, epsilon, pinned);
  if (simplified.length < MIN_LOOP_POINTS) return null;
  const straightened = flattenStraightRuns(
    simplified,
    true,
    corners,
    flattenStrength,
    finish.pixelScale,
  );
  if (straightened.length < MIN_LOOP_POINTS) return null;
  // The resample's corners: the dial's, plus any hard turn of the simplified
  // outline it never saw; the fit keeps the same ones exact.
  const outputCorners = collectOutputCorners(straightened, true, corners);
  // Fix B: each chord's resample stays within the offsets of the dense
  // stretch Douglas-Peucker collapsed onto it, so a straight run cannot bow
  // into paper (a binary 2 px bar grew 49% in area) while an arc keeps its
  // sagitta (contour-chord-band.ts).
  const band = denseChordBand(flattened, straightened, finish.pixelScale);
  const resample = (amount: number): Vec2[] =>
    fitSmoothCurve(
      straightened,
      true,
      outputCorners,
      SPLINE_SAMPLES_PER_SEGMENT,
      epsilon * amount,
      band,
    );
  return compactRefinement(
    straightened,
    resample,
    outputCorners,
    finish,
    compactTolerances(FIT_TOLERANCE_PX, finish),
  );
}

// The measured-loop output tail: the compact fit segmented at the dial's
// corners at the fit tolerance, which Optimize scales.
function fitLoopTail(
  chain: ReadonlyArray<Polyline['points'][number]>,
  corners: ReadonlySet<Polyline['points'][number]>,
  finish: LoopFinish,
  tolerancePx: number,
): ContourRefinement | null {
  return compactRefinement(
    chain,
    () => chain,
    corners,
    finish,
    compactTolerances(tolerancePx, finish),
  );
}

// Optimize scales the final tolerance only. Candidate joints are proposed at a
// fixed share of the tolerance Optimize 0 gives, so they never follow
// Optimize and the merge's segment count is monotone in it (ADR-530).
function compactTolerances(
  tolerancePx: number,
  finish: LoopFinish,
): { readonly tolerance: number; readonly candidateTolerance: number } {
  const base = tolerancePx * finish.pixelScale;
  const floorScale = Math.min(finish.fitToleranceScale, MIN_OPTIMIZE_TOLERANCE_SCALE);
  return {
    tolerance: base * finish.fitToleranceScale,
    candidateTolerance: base * floorScale * CANDIDATE_TOLERANCE_SHARE,
  };
}

// Fit the ring's compact curve (compact-curve-fit.ts, ADR-530) through
// `target(amount)` and carry it on the ring object itself (trace-curves.ts).
// The topology repair's weaker refinements scale the tolerances down with
// the target's own smoothing.
function compactRefinement(
  baselinePoints: ReadonlyArray<Vec2>,
  target: (amount: number) => ReadonlyArray<Vec2>,
  corners: ReadonlySet<Vec2>,
  finish: LoopFinish,
  tolerances: { readonly tolerance: number; readonly candidateTolerance: number },
): ContourRefinement | null {
  const tangentWindow = TANGENT_WINDOW_PX * finish.pixelScale;
  const { tolerance, candidateTolerance } = tolerances;
  const ring = (amount: number): Polyline | null => {
    const curve = fitCompactRing(target(amount), corners, {
      tolerance: tolerance * amount,
      candidateTolerance: candidateTolerance * amount,
      tangentWindow,
    });
    if (curve === null) return null;
    const points = sampleCompactCurve(curve);
    return points.length - 1 < MIN_LOOP_POINTS ? null : curvedTraceRing(points, curve);
  };
  const polyline = ring(1);
  if (polyline === null) return null;
  const baseline = closeContour(baselinePoints);
  return {
    polyline,
    baseline,
    refine: (amount) => {
      if (amount === 1) return polyline;
      return amount < MIN_REFIT_AMOUNT ? baseline : (ring(amount) ?? baseline);
    },
  };
}
