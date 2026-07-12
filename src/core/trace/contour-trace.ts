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
import {
  midCrackChainWithStats,
  traceBoundaryLoops,
  type CrackSubPixelField,
} from './contour-boundary';
import { fairChainSegments } from './fair-chain';
import { fitCubicsThroughPoints, sampleCubics } from './fit-cubics';
import { flattenStraightRuns } from './flatten-straight-runs';
import { smoothArcNoise } from './smooth-arc-noise';
import { withCanonicalTraceCurves } from './trace-curves';
import {
  crackFieldForTrace,
  effectivePixelScale,
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
// A loop whose cracks mostly interpolated is a sub-pixel MEASUREMENT (see
// finishLoop): above this fraction the wobble stages disable for that loop.
const SUBPIXEL_INFORMED_FRACTION = 0.3;
// Least-squares cubic fit tolerance for the measured-loop output tail, in
// SOURCE px (scaled by pixelScale like every px knob). ~2-3x the sub-pixel
// measurement noise: tight enough to keep drawn features, loose enough that
// the fit averages noise instead of chasing it.
const FIT_TOLERANCE_PX = 0.35;
// Above-range (organic art) loops are Whittaker-faired BEFORE fitting
// (fair-chain.ts, research brief #3): the penalized smoother removes ~94%
// of the ink texture in one banded solve, so the fit sees ~0.1-0.2px
// residual noise and this tolerance (~3x that) physically cannot trigger
// texture-chasing error splits. Tolerance-based fairing was tried twice and
// still sawed — splitting on max error chases any bump above tolerance.
const FIT_TOLERANCE_ORGANIC_PX = 0.55;
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
  // Pixel-denominated knobs keep SOURCE-pixel semantics on a supersampled
  // trace: areas scale by scale², lengths (simplify ε) by scale.
  const scale = effectivePixelScale(options);
  const polylines = contourPolylinesFromMask(mask, {
    minAreaPx: Math.max(options.ignoreLessThanPixels ?? 0, 0) * scale * scale,
    epsilonPx: SIMPLIFY_EPSILON_PX * Math.max(0.1, options.lineTolerance ?? 1) * scale,
    flattenStrength: flattenStrengthFromSmoothness(options.smoothness),
    pixelScale: scale,
    ...(crackField === null ? {} : { crackField }),
  });
  return polylines.length === 0
    ? []
    : withCanonicalTraceCurves([{ color: CONTOUR_COLOR, polylines }]);
}

export type ContourFinishOptions = {
  /** Loops (either polarity) below this area in px² are dropped. */
  readonly minAreaPx: number;
  /** Douglas-Peucker tolerance and spline deviation cap, px. */
  readonly epsilonPx: number;
  /** Wobble-flattening strength (see flatten-straight-runs.ts); 0 = off. */
  readonly flattenStrength: number;
  /** Supersampling factor of the mask; scales the sharpener's chain-length
   *  regime bounds so glyphs stay in the same regime they were tuned in. */
  readonly pixelScale?: number;
  /** Pre-threshold field for sub-pixel crack interpolation; omitted = plain
   *  mid-crack vertices (binary-only callers like the edge lane). */
  readonly crackField?: CrackSubPixelField;
};

/** Finish a binary ink mask into smooth closed outlines — the shared
 *  geometry stage behind the filled-contours lane and (via its own mask
 *  builder) the Edge Detection lane. */
export function contourPolylinesFromMask(mask: InkMask, options: ContourFinishOptions): Polyline[] {
  const pixelScale =
    options.pixelScale !== undefined && Number.isFinite(options.pixelScale)
      ? Math.max(1, options.pixelScale)
      : 1;
  const finish: LoopFinish = {
    distSq: squaredDistanceField(mask),
    width: mask.width,
    epsilonPx: options.epsilonPx,
    flattenStrength: options.flattenStrength,
    pixelScale,
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
  readonly pixelScale: number;
  readonly crackField: CrackSubPixelField | undefined;
};

function finishLoop(
  staircase: ReadonlyArray<Polyline['points'][number]>,
  finish: LoopFinish,
): Polyline | null {
  const { distSq, width } = finish;
  if (staircase.length < MIN_LOOP_POINTS) return null;
  // Mid-crack first (lattice steps become ≤45° bends; sub-pixel interpolated
  // when the pre-threshold field is available), then the SAME raw Taubin
  // pre-smoothing the skeleton tracer applies — without it the residual
  // staircase jogs read as corners downstream and long straight edges come
  // out wobbly (maintainer-observed on the arch-house H stems).
  const crack = midCrackChainWithStats(staircase, finish.crackField);
  const dense = smoothRawChain(crack.points, true);
  // The wobble stages (straight-run flattener, arc-noise evening) are
  // quantization-noise medicine. When most cracks carried real sub-pixel
  // information, the boundary is a MEASUREMENT — chord-replacing it
  // fabricates joint steps on gently flaring stems (maintainer H-stem
  // verdicts, 2026-07-11) and evening it fights drawn texture. Binary
  // sources (saturated steps, fraction ~0) keep the full 1x behaviour.
  const subPixelInformed = crack.interpolatedFraction >= SUBPIXEL_INFORMED_FRACTION;
  // The chain-length regime bounds were tuned at 1x; a supersampled chain is
  // pixelScale× denser, so the bounds scale with it — a LANGEBAAN-size glyph
  // must stay in the same (sparse-detection) regime it was tuned for.
  const sharpenMin = SHARPEN_MIN_CHAIN_POINTS * finish.pixelScale;
  const sharpenMax = SHARPEN_MAX_CHAIN_POINTS * finish.pixelScale;
  const inSharpenRange = dense.length >= sharpenMin && dense.length <= sharpenMax;
  // Measured loops skip the wobble stages entirely: the chord flattener
  // fabricates joint steps on measured stems, and above-range loops now get
  // the principled Whittaker fairing instead of the arc-noise evening.
  const flattenStrengthEff = subPixelInformed ? 0 : finish.flattenStrength;
  const arcStrengthEff = subPixelInformed ? 0 : finish.flattenStrength;
  const sharpened = inSharpenRange
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
    dense.length >= sharpenMin
      ? smoothArcNoise(evened, true, sharpened.corners, arcStrengthEff, finish.pixelScale)
      : evened;
  // Measured loops with an evidence-based corner set (sharpener range) take
  // the fairing-by-fitting tail: least-squares cubics THROUGH the measured
  // points replace simplify+flatten+spline — the fit averages ~0.1px noise
  // into fair curves with no chord joints and no per-vertex facets
  // (research brief #2). Tiny glyphs and beyond-range art loops keep the
  // approved legacy tail until the fit path earns them.
  if (subPixelInformed && dense.length >= sharpenMin) {
    return finishMeasuredLoop(arcSmoothed, sharpened, inSharpenRange, finish);
  }
  return finishLegacyLoop(arcSmoothed, sharpened.corners, flattenStrengthEff, finish);
}

// Measured loops end in the fairing-by-fitting tail: least-squares cubics
// THROUGH the measured points, with no chord joints or per-vertex facets.
// In-range loops carry the sharpener's evidence-backed corners; larger loops
// (arch bands, waves, house outline) detect theirs from windowed dense turns
// so needle tips and roof corners still pin exactly, then are Whittaker-
// faired between those pins before the tighter fit.
function finishMeasuredLoop(
  arcSmoothed: ReadonlyArray<Polyline['points'][number]>,
  sharpened: { readonly corners: ReadonlySet<Polyline['points'][number]> },
  inSharpenRange: boolean,
  finish: LoopFinish,
): Polyline | null {
  if (inSharpenRange) {
    return fitLoopTail(arcSmoothed, sharpened.corners, finish, FIT_TOLERANCE_PX);
  }
  const corners = denseHardTurnCorners(arcSmoothed, finish.pixelScale);
  const faired = fairChainSegments(arcSmoothed, true, corners, finish.pixelScale);
  return fitLoopTail(faired, corners, finish, FIT_TOLERANCE_ORGANIC_PX);
}

// The legacy tail (binary / pixel-fidelity sources): simplify → straight-run
// flatten → corner-aware spline resample → close the ring.
function finishLegacyLoop(
  arcSmoothed: ReadonlyArray<Polyline['points'][number]>,
  corners: ReadonlySet<Polyline['points'][number]>,
  flattenStrength: number,
  finish: LoopFinish,
): Polyline | null {
  const simplified = simplifyChain(arcSmoothed, true, finish.epsilonPx);
  if (simplified.length < MIN_LOOP_POINTS) return null;
  // Rough source edges leave long-wavelength waviness that survives both
  // evening and simplification (nominally straight stems trace wobbly);
  // collapse curvature-safe straight runs before the spline resample.
  const straightened = flattenStraightRuns(
    simplified,
    true,
    corners,
    flattenStrength,
    finish.pixelScale,
  );
  if (straightened.length < MIN_LOOP_POINTS) return null;
  // Closed rings must RETURN to their start point (ADR-100 third amendment):
  // renderers and emitters draw points as given and never synthesise the
  // closing edge, so a ring left "open" engraves with a seam gap.
  const closed = closeRingEndpoints([
    {
      points: refineChainForOutput(straightened, true, corners, finish.epsilonPx),
      closed: true,
    },
  ]);
  return closed[0] ?? null;
}

// The measured-loop output tail: G1 cubic fit segmented at the sharpener's
// evidence-backed corners, resampled to the polyline contract.
function fitLoopTail(
  chain: ReadonlyArray<Polyline['points'][number]>,
  corners: ReadonlySet<Polyline['points'][number]>,
  finish: LoopFinish,
  tolerancePx: number,
): Polyline | null {
  const cubics = fitCubicsThroughPoints(chain, true, corners, tolerancePx * finish.pixelScale);
  const sampled = sampleCubics(cubics, true);
  if (sampled.length < MIN_LOOP_POINTS) return null;
  const closed = closeRingEndpoints([{ points: sampled, closed: true }]);
  return closed[0] ?? null;
}

// Windowed hard-turn corner detection for loops the sharpener never saw
// (above its chain-length range): chord tangents ±span px around each
// vertex, pin turns ≥ the shared 60° hard-turn convention, greedy non-max
// suppression so one physical corner yields one pin.
const DENSE_CORNER_SPAN_PX = 2;
// A drawn corner's direction change PERSISTS when the window widens; a
// brush-texture bump's net turn reverts toward zero (the edge continues the
// same way). Requiring the turn at ±2px AND at ±6px separates structural
// corners (eaves, wave tips — pinned) from ink texture (faired) — an angle
// bar alone cannot, because both classes turn 60-80° up close.
const DENSE_CORNER_TURN_RAD = (60 * Math.PI) / 180;
const DENSE_CORNER_PERSIST_SPAN_PX = 6;
const DENSE_CORNER_PERSIST_TURN_RAD = (50 * Math.PI) / 180;

function denseHardTurnCorners(
  points: ReadonlyArray<Polyline['points'][number]>,
  pixelScale: number,
): ReadonlySet<Polyline['points'][number]> {
  const n = points.length;
  const corners = new Set<Polyline['points'][number]>();
  if (n < 8) return corners;
  const perimeter = ringPerimeter(points);
  const avgSpacing = Math.max(1e-6, perimeter / n);
  const k = Math.max(2, Math.round((DENSE_CORNER_SPAN_PX * pixelScale) / avgSpacing));
  const kPersist = Math.max(
    k + 1,
    Math.round((DENSE_CORNER_PERSIST_SPAN_PX * pixelScale) / avgSpacing),
  );
  const turns: number[] = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    const near = windowedTurn(points, i, k);
    // Zero out candidates whose turn does not persist at the wider span —
    // they are texture, not structure.
    turns[i] =
      near >= DENSE_CORNER_TURN_RAD &&
      windowedTurn(points, i, kPersist) >= DENSE_CORNER_PERSIST_TURN_RAD
        ? near
        : 0;
  }
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (turns[b] ?? 0) - (turns[a] ?? 0),
  );
  const taken = new Uint8Array(n);
  for (const i of order) {
    if ((turns[i] ?? 0) < DENSE_CORNER_TURN_RAD) break;
    if (taken[i] === 1) continue;
    corners.add(points[i] as Polyline['points'][number]);
    for (let d = -2 * k; d <= 2 * k; d += 1) {
      taken[(i + d + n) % n] = 1;
    }
  }
  return corners;
}

function ringPerimeter(points: ReadonlyArray<Polyline['points'][number]>): number {
  let length = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i] as Polyline['points'][number];
    const b = points[(i + 1) % points.length] as Polyline['points'][number];
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

function windowedTurn(
  points: ReadonlyArray<Polyline['points'][number]>,
  i: number,
  k: number,
): number {
  const n = points.length;
  const prev = points[(i - k + n) % n] as Polyline['points'][number];
  const at = points[i] as Polyline['points'][number];
  const next = points[(i + k) % n] as Polyline['points'][number];
  const inLen = Math.hypot(at.x - prev.x, at.y - prev.y);
  const outLen = Math.hypot(next.x - at.x, next.y - at.y);
  if (inLen < 1e-9 || outLen < 1e-9) return 0;
  const dot =
    ((at.x - prev.x) / inLen) * ((next.x - at.x) / outLen) +
    ((at.y - prev.y) / inLen) * ((next.y - at.y) / outLen);
  return Math.acos(Math.max(-1, Math.min(1, dot)));
}
