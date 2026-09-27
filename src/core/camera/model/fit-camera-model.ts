// Fit the camera model to observed target points (ADR-440). One solver serves
// every calibration flow: a single overhead photo of the engraved bed target
// (one view, the lens and the pose together), a hand-held printed board (many
// views, one shared lens), or a re-fit of the pose alone once the lens is
// known. Multi-start over the focal length, then Levenberg-Marquardt with
// Marquardt scaling; points far off the fit are dropped once and the fit is
// repeated so one mis-detected dot cannot bend the whole model. Pure core.

import type { FisheyeDistortion } from '../fisheye';
import { undistortPixel } from '../fisheye';
import { choleskySolve, inverseDiagonal } from './cholesky';
import {
  cameraCentre,
  projectWorldPoint,
  type CameraPose,
  type LensModel,
  type Vec2,
  type Vec3,
} from './camera-model';
import { solveLeastSquares } from './least-squares';
import { dropOutliers, remapResiduals } from './fit-outliers';
import { fitPlaneHomography, poseFromPlaneHomography } from './plane-pose';
import { rodriguesToMatrix } from '../rodrigues';

export type ObservedPoint = { readonly world: Vec3; readonly pixel: Vec2 };
export type ObservedView = { readonly points: ReadonlyArray<ObservedPoint> };

export type FitOptions = {
  readonly imageWidth: number;
  readonly imageHeight: number;
  /** Keep this lens fixed and fit only the poses. */
  readonly fixedLens?: LensModel;
  /** Distortion terms left free: 0, 2 (k1,k2) or 4 (k1..k4). Default 4. */
  readonly distortionTerms?: 0 | 2 | 4;
  /**
   * Standard deviation (px) of a prior pulling the principal point toward the
   * image centre. A single flat view cannot separate it from camera tilt, so
   * the bed fit uses a weak prior; multi-view fits leave it free.
   */
  readonly principalPointSigmaPx?: number;
  /**
   * Measured camera height above the bed (mm) for the first view, with its
   * standard deviation. A camera looking straight down at one flat target
   * cannot tell a long lens far away from a short lens close up: both put the
   * marks in the same pixels at the target's height and disagree everywhere
   * else. A tape-measure reading settles it; a tilted camera barely needs it.
   */
  readonly cameraHeightPrior?: { readonly heightMm: number; readonly sigmaMm: number };
  /** Focal seeds as fractions of the image width. */
  readonly focalSeeds?: ReadonlyArray<number>;
  readonly maxIterations?: number;
};

export type CameraFit = {
  readonly kind: 'ok';
  readonly lens: LensModel;
  readonly poses: ReadonlyArray<CameraPose>;
  /** Per-view, per-point reprojection error in pixels (NaN for dropped points). */
  readonly residualsPx: ReadonlyArray<ReadonlyArray<number>>;
  readonly rmsPx: number;
  readonly droppedPoints: number;
  readonly iterations: number;
  readonly converged: boolean;
  /** One-sigma uncertainty of [f, aspect, cx, cy, k1..k4]; NaN when fixed. */
  readonly lensSigma: ReadonlyArray<number>;
  /**
   * One-sigma uncertainty of the first view's camera height above the bed,
   * mm. Large when a camera looks straight down at one flat target and no
   * measured height was given (see cameraHeightPrior).
   */
  readonly cameraHeightSigmaMm: number;
};

export type CameraFitFailure = {
  readonly kind: 'failed';
  readonly reason: 'too-few-points' | 'no-initial-pose' | 'diverged';
};

const LENS_PARAMS = 8; // f, aspect, cx, cy, k1..k4
const POSE_PARAMS = 6;
const MIN_POINTS_PER_VIEW = 6;
const DEFAULT_FOCAL_SEEDS = [0.35, 0.5, 0.7, 1.0, 1.4];
const ASPECT_SIGMA = 0.01;
const SEED_ITERATIONS = 25;
const ROBUST_PX = 1;
// Typical ring or corner detection noise; a clean synthetic fit's residual is
// never trusted below it when judging what the data pin down.
const MIN_POINT_NOISE_PX = 0.25;

type Layout = {
  readonly free: ReadonlyArray<number>; // full-vector index of each solver parameter
  readonly full: Float64Array; // full vector with fixed values filled in
};

type Problem = {
  readonly views: ReadonlyArray<ObservedView>;
  readonly options: FitOptions;
  /** Huber threshold in px, or null for plain least squares. */
  readonly robustPx: number | null;
  readonly layout: Layout;
  readonly offsets: ReadonlyArray<number>; // first residual of each view
  readonly pointResiduals: number;
  /** Lens priors (aspect, principal point) when the lens is free. */
  readonly lensPriorCount: number;
  readonly priorCount: number;
};

export function fitCameraModel(
  views: ReadonlyArray<ObservedView>,
  options: FitOptions,
): CameraFit | CameraFitFailure {
  if (views.length === 0 || views.some((v) => v.points.length < MIN_POINTS_PER_VIEW)) {
    return { kind: 'failed', reason: 'too-few-points' };
  }
  const first = bestSeed(views, options);
  if (first === null) return { kind: 'failed', reason: 'no-initial-pose' };
  const iterations = options.maxIterations ?? 200;
  // A robust pass first, so a gross mis-detection cannot drag every other
  // residual past the outlier limit, then plain least squares on the rest.
  const robust = refine(views, options, first, iterations, ROBUST_PX);
  const kept = dropOutliers(views, robust.residualsPx, MIN_POINTS_PER_VIEW);
  if (kept.dropped === 0) return refine(views, options, fullVectorOf(robust), iterations, null);
  const again = refine(kept.views, options, fullVectorOf(robust), iterations, null);
  return {
    ...again,
    residualsPx: remapResiduals(views, kept.keptIndex, again.residualsPx),
    droppedPoints: kept.dropped,
  };
}

function bestSeed(views: ReadonlyArray<ObservedView>, options: FitOptions): Float64Array | null {
  const seeds = options.fixedLens === undefined ? (options.focalSeeds ?? DEFAULT_FOCAL_SEEDS) : [0];
  let best: { readonly cost: number; readonly full: Float64Array } | null = null;
  for (const seed of seeds) {
    const lens = options.fixedLens ?? seedLens(options, seed * options.imageWidth);
    const start = initialVector(views, lens);
    if (start === null) continue;
    const problem = buildProblem(views, options, start, ROBUST_PX);
    const solved = solveLeastSquares(asLsq(problem), freeVector(problem.layout), {
      maxIterations: SEED_ITERATIONS,
    });
    if (best === null || solved.cost < best.cost) {
      best = { cost: solved.cost, full: expand(problem.layout, solved.params) };
    }
  }
  return best?.full ?? null;
}

function refine(
  views: ReadonlyArray<ObservedView>,
  options: FitOptions,
  start: Float64Array,
  maxIterations: number,
  robustPx: number | null,
): CameraFit {
  const problem = buildProblem(views, options, start, robustPx);
  const solved = solveLeastSquares(asLsq(problem), freeVector(problem.layout), { maxIterations });
  const full = expand(problem.layout, solved.params);
  const residualsPx = pointErrors(problem, full);
  const all = residualsPx.flat();
  const rmsPx = Math.sqrt(all.reduce((s, e) => s + e * e, 0) / Math.max(all.length, 1));
  return {
    kind: 'ok',
    lens: lensOf(full, options),
    poses: views.map((_, v) => poseOf(full, v)),
    residualsPx,
    rmsPx,
    droppedPoints: 0,
    iterations: solved.iterations,
    converged: solved.converged,
    lensSigma: lensSigma(problem, solved.normalMatrix, solved.cost),
    cameraHeightSigmaMm: cameraHeightSigma(problem, full, solved.normalMatrix, rmsPx),
  };
}

function seedLens(options: FitOptions, focal: number): LensModel {
  return {
    intrinsics: {
      fx: focal,
      fy: focal,
      cx: (options.imageWidth - 1) / 2,
      cy: (options.imageHeight - 1) / 2,
    },
    distortion: [0, 0, 0, 0],
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
  };
}

// Full vector: [f, aspect, cx, cy, k1, k2, k3, k4, (rvec, tvec) per view].
function initialVector(views: ReadonlyArray<ObservedView>, lens: LensModel): Float64Array | null {
  const k = lens.intrinsics;
  const full = new Float64Array(LENS_PARAMS + POSE_PARAMS * views.length);
  full.set([k.fx, k.fy / k.fx, k.cx, k.cy, ...lens.distortion]);
  for (let v = 0; v < views.length; v += 1) {
    const pose = initialPose(views[v] as ObservedView, lens);
    if (pose === null) return null;
    full.set([...pose.rvec, ...pose.tvec], LENS_PARAMS + POSE_PARAMS * v);
  }
  return full;
}

function initialPose(view: ObservedView, lens: LensModel): CameraPose | null {
  const planeZ = view.points[0]?.world.z ?? 0;
  const pairs = view.points.map((p) => ({
    plane: { x: p.world.x, y: p.world.y },
    ray: undistortPixel(p.pixel.x, p.pixel.y, lens.intrinsics, lens.distortion),
  }));
  const h = fitPlaneHomography(pairs);
  return h === null ? null : poseFromPlaneHomography(h, planeZ);
}

function freeIndices(options: FitOptions, viewCount: number): number[] {
  const free: number[] = [];
  if (options.fixedLens === undefined) {
    free.push(0, 1, 2, 3);
    const terms = options.distortionTerms ?? 4;
    for (let i = 0; i < terms; i += 1) free.push(4 + i);
  }
  for (let i = LENS_PARAMS; i < LENS_PARAMS + POSE_PARAMS * viewCount; i += 1) free.push(i);
  return free;
}

function buildProblem(
  views: ReadonlyArray<ObservedView>,
  options: FitOptions,
  full: Float64Array,
  robustPx: number | null,
): Problem {
  const offsets: number[] = [];
  let count = 0;
  for (const view of views) {
    offsets.push(count);
    count += view.points.length * 2;
  }
  const lensPriorCount = options.fixedLens === undefined ? 3 : 0;
  const heightPriorCount = options.cameraHeightPrior === undefined ? 0 : 1;
  return {
    views,
    options,
    robustPx,
    layout: { free: freeIndices(options, views.length), full: Float64Array.from(full) },
    offsets,
    pointResiduals: count,
    lensPriorCount,
    priorCount: lensPriorCount + heightPriorCount,
  };
}

function asLsq(problem: Problem) {
  const scratch = Float64Array.from(problem.layout.full);
  return {
    paramCount: problem.layout.free.length,
    residualCount: problem.pointResiduals + problem.priorCount,
    residuals: (params: Float64Array, out: Float64Array) => {
      problem.layout.free.forEach((index, k) => (scratch[index] = params[k] ?? 0));
      fillResiduals(problem, scratch, out);
    },
    influence: (k: number): readonly [number, number] => influenceOf(problem, k),
    step: (k: number, value: number) => stepOf(problem.layout.free[k] ?? 0, value),
  };
}

function influenceOf(problem: Problem, k: number): readonly [number, number] {
  const index = problem.layout.free[k] ?? 0;
  if (index < LENS_PARAMS) return [0, problem.pointResiduals + problem.priorCount];
  const view = Math.floor((index - LENS_PARAMS) / POSE_PARAMS);
  const start = problem.offsets[view] ?? 0;
  // The first view's pose also moves the camera-height prior at the end.
  if (view === 0 && problem.options.cameraHeightPrior !== undefined) {
    return [start, problem.pointResiduals + problem.priorCount];
  }
  return [start, start + (problem.views[view]?.points.length ?? 0) * 2];
}

// Rotation and distortion are dimensionless, focal and translation are
// hundreds of px/mm: give each a step proportional to its natural scale.
function stepOf(index: number, value: number): number {
  if (index === 1 || (index >= 4 && index < LENS_PARAMS)) return 1e-7;
  const inPose = index >= LENS_PARAMS ? (index - LENS_PARAMS) % POSE_PARAMS : -1;
  if (inPose >= 0 && inPose < 3) return 1e-7;
  return 1e-6 * Math.max(Math.abs(value), 1);
}

function fillResiduals(problem: Problem, full: Float64Array, out: Float64Array): void {
  const lens = lensOf(full, problem.options);
  problem.views.forEach((view, v) => {
    const pose = poseOf(full, v);
    const rotation = rodriguesToMatrix(pose.rvec);
    let row = problem.offsets[v] ?? 0;
    for (const point of view.points) {
      const projected = projectWorldPoint(lens, pose, point.world, rotation);
      const dx = projected === null ? 1e4 : projected.x - point.pixel.x;
      const dy = projected === null ? 1e4 : projected.y - point.pixel.y;
      const weight = huberWeight(Math.hypot(dx, dy), problem.robustPx);
      out[row] = dx * weight;
      out[row + 1] = dy * weight;
      row += 2;
    }
  });
  if (problem.priorCount > 0) fillPriors(problem, full, out);
}

// Scale a residual so its square is the Huber loss: quadratic up to the
// threshold, linear beyond it.
function huberWeight(norm: number, threshold: number | null): number {
  if (threshold === null || norm <= threshold) return 1;
  return Math.sqrt((2 * threshold) / norm - (threshold * threshold) / (norm * norm));
}

function fillPriors(problem: Problem, full: Float64Array, out: Float64Array): void {
  const { imageWidth, imageHeight, cameraHeightPrior } = problem.options;
  const base = problem.pointResiduals;
  if (problem.lensPriorCount > 0) {
    const sigma = problem.options.principalPointSigmaPx ?? Number.POSITIVE_INFINITY;
    out[base] = ((full[1] ?? 1) - 1) / ASPECT_SIGMA;
    out[base + 1] = ((full[2] ?? 0) - (imageWidth - 1) / 2) / sigma;
    out[base + 2] = ((full[3] ?? 0) - (imageHeight - 1) / 2) / sigma;
  }
  if (cameraHeightPrior !== undefined) {
    // Scaled into pixels of typical detection noise so the measurement and
    // the photo are weighed against each other by their real uncertainties.
    const height = -cameraCentre(poseOf(full, 0)).z;
    out[base + problem.lensPriorCount] =
      ((height - cameraHeightPrior.heightMm) / cameraHeightPrior.sigmaMm) * MIN_POINT_NOISE_PX;
  }
}

function lensOf(full: Float64Array, options: FitOptions): LensModel {
  if (options.fixedLens !== undefined) return options.fixedLens;
  const f = full[0] ?? 1;
  const distortion: FisheyeDistortion = [full[4] ?? 0, full[5] ?? 0, full[6] ?? 0, full[7] ?? 0];
  return {
    intrinsics: { fx: f, fy: f * (full[1] ?? 1), cx: full[2] ?? 0, cy: full[3] ?? 0 },
    distortion,
    imageWidth: options.imageWidth,
    imageHeight: options.imageHeight,
  };
}

function poseOf(full: Float64Array, view: number): CameraPose {
  const o = LENS_PARAMS + POSE_PARAMS * view;
  return {
    rvec: [full[o] ?? 0, full[o + 1] ?? 0, full[o + 2] ?? 0],
    tvec: [full[o + 3] ?? 0, full[o + 4] ?? 0, full[o + 5] ?? 0],
  };
}

function freeVector(layout: Layout): Float64Array {
  return Float64Array.from(layout.free.map((index) => layout.full[index] ?? 0));
}

function expand(layout: Layout, params: Float64Array): Float64Array {
  const full = Float64Array.from(layout.full);
  layout.free.forEach((index, k) => (full[index] = params[k] ?? 0));
  return full;
}

function fullVectorOf(fit: CameraFit): Float64Array {
  const k = fit.lens.intrinsics;
  const full = new Float64Array(LENS_PARAMS + POSE_PARAMS * fit.poses.length);
  full.set([k.fx, k.fy / k.fx, k.cx, k.cy, ...fit.lens.distortion]);
  fit.poses.forEach((pose, v) =>
    full.set([...pose.rvec, ...pose.tvec], LENS_PARAMS + POSE_PARAMS * v),
  );
  return full;
}

function pointErrors(problem: Problem, full: Float64Array): number[][] {
  const out = new Float64Array(problem.pointResiduals + problem.priorCount);
  fillResiduals({ ...problem, robustPx: null }, full, out);
  return problem.views.map((view, v) => {
    const start = problem.offsets[v] ?? 0;
    return view.points.map((_, i) =>
      Math.hypot(out[start + 2 * i] ?? 0, out[start + 2 * i + 1] ?? 0),
    );
  });
}

function lensSigma(problem: Problem, normal: Float64Array, cost: number): number[] {
  const sigma = new Array<number>(LENS_PARAMS).fill(Number.NaN);
  const dof = problem.pointResiduals - problem.layout.free.length;
  if (dof <= 0) return sigma;
  const variance = inverseDiagonal(normal, problem.layout.free.length);
  if (variance === null) return sigma;
  const residualVariance = cost / dof;
  problem.layout.free.forEach((index, k) => {
    if (index < LENS_PARAMS) sigma[index] = Math.sqrt((variance[k] ?? 0) * residualVariance);
  });
  return sigma;
}

// Linearised: σ² = gᵀ·N⁻¹·g·σ_px², with g the height's gradient over the free
// parameters and N the normal matrix (priors included, so a measured height
// bounds it).
function cameraHeightSigma(
  problem: Problem,
  full: Float64Array,
  normal: Float64Array,
  rmsPx: number,
): number {
  const base = -cameraCentre(poseOf(full, 0)).z;
  const gradient = new Float64Array(problem.layout.free.length);
  problem.layout.free.forEach((index, k) => {
    if (index < LENS_PARAMS || index >= LENS_PARAMS + POSE_PARAMS) return;
    const step = stepOf(index, full[index] ?? 0);
    const shifted = Float64Array.from(full);
    shifted[index] = (shifted[index] ?? 0) + step;
    gradient[k] = (-cameraCentre(poseOf(shifted, 0)).z - base) / step;
  });
  const solved = choleskySolve(normal, gradient, gradient.length);
  if (solved === null) return Number.POSITIVE_INFINITY;
  const quadratic = gradient.reduce((sum, g, k) => sum + g * (solved[k] ?? 0), 0);
  return Math.sqrt(Math.max(quadratic, 0)) * Math.max(rmsPx, MIN_POINT_NOISE_PX);
}
