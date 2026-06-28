// Fisheye intrinsic calibration entry point (ADR-095, v2.c). Validates board
// observations, seeds intrinsics/extrinsics, refines them by minimising total
// reprojection error with Levenberg-Marquardt, and reports per-corner RMS and
// quadrant coverage. Pure core: deterministic, no I/O. The single public surface
// of the calibration module.
//
// NOTE: green here proves the solver recovers a known K/D from clean synthetic
// geometry. It does NOT prove a real Falcon frame de-fisheyes — that is the
// hardware/perceptual gate (ADR-025, the "Apply Calibration?" A/B toggle).

import type { Vec2 } from '../scene';
import { buildActiveMask, computeResiduals, type ResidualContext } from './calibrate-residuals';
import { perCornerRms, type QuadrantCoverage, quadrantCoverage } from './calibrate-metrics';
import type { CameraIntrinsics, FisheyeDistortion } from './fisheye';
import { seedCalibration } from './init-guess';
import { type LevMarExit, type LevMarOptions, levenbergMarquardt } from './levmar';
import { packParams, unpackParams } from './lm-params';

export type { QuadrantCoverage } from './calibrate-metrics';

/** One captured board pose: the planar target points and their (possibly missing) detections. */
export type BoardObservation = {
  readonly objectPoints: ReadonlyArray<Vec2>;
  readonly imagePoints: ReadonlyArray<Vec2 | null>;
};

/** A solved camera pose for one view. */
export type ViewExtrinsics = {
  readonly rvec: readonly [number, number, number];
  readonly tvec: readonly [number, number, number];
};

export type CalibrationFailure =
  | 'too-few-views'
  | 'too-few-points'
  | 'rank-deficient'
  | 'no-convergence';

/**
 * A solved calibration, or a typed failure. On success the units are pinned so
 * downstream consumers (v2.d shader, v2.e wizard) cannot misread them:
 * - `intrinsics` (fx, fy, cx, cy) are PIXELS of an `imageWidth`x`imageHeight` frame;
 *   rectifying a different resolution requires rescaling them by the size ratio.
 * - `distortion` is the Kannala-Brandt theta-polynomial `[k1,k2,k3,k4]` (see FisheyeDistortion).
 * - `views[i]` carries that pose's `rvec` (axis-angle radians) and `tvec` (mm).
 * - `rmsPx` / `perViewRmsPx` are per-corner Euclidean reprojection RMS in pixels.
 * - `converged` is true only when the solve stopped on tolerance; `exit` gives the
 *   detail (`iteration-cap`/`damping-stall` mean the fit is best-effort — the wizard
 *   should warn before applying). A best-effort fit is still returned, OpenCV-style.
 */
export type CalibrationResult =
  | {
      readonly kind: 'ok';
      readonly intrinsics: CameraIntrinsics;
      readonly distortion: FisheyeDistortion;
      readonly imageWidth: number;
      readonly imageHeight: number;
      readonly views: ReadonlyArray<ViewExtrinsics>;
      readonly perViewRmsPx: ReadonlyArray<number>;
      readonly rmsPx: number;
      readonly iterations: number;
      readonly converged: boolean;
      readonly exit: LevMarExit;
      readonly coverage: ReadonlyArray<QuadrantCoverage>;
    }
  | { readonly kind: 'failed'; readonly reason: CalibrationFailure };

export type CalibrationOptions = {
  readonly maxIterations?: number;
  readonly tolerance?: number;
  readonly initialGuess?: {
    readonly imageWidth: number;
    readonly imageHeight: number;
  } & Partial<CameraIntrinsics>;
  // Distortion model. 'k1k2k3k4' (default) frees all four KB terms — correct when the
  // board is seen across a wide field. 'k1k2' freezes k3=k4=0, which the wizard should
  // prefer for low-angular-coverage Falcon captures where k3,k4 only overfit noise.
  readonly distortionModel?: 'k1k2' | 'k1k2k3k4';
};

const MIN_VIEWS = 2;
const MIN_POINTS_PER_VIEW = 4;
// Coarse wide-fisheye focal guess (fraction of image width) when no measured
// nominal focal is supplied. A starting point for LM, not a calibrated value.
const NOMINAL_FOCAL_FRACTION = 0.7;
// Generous default so a normal wrong-K capture is never silently rejected as
// 'no-convergence' on the iteration cap; callers can lower it deliberately.
const DEFAULT_MAX_ITERATIONS = 300;
// Flat-parameter positions of k3 and k4 (after fx,fy,cx,cy,k1,k2); frozen by the
// 'k1k2' distortion model so the weakly-observed high-order terms cannot overfit.
const K3_K4_PARAM_INDICES = [6, 7];

type ValidatedViews = {
  readonly boardPoints: ReadonlyArray<Vec2>;
  readonly imagePointsPerView: ReadonlyArray<ReadonlyArray<Vec2 | null>>;
  readonly numViews: number;
};

// The seed intrinsics plus the frame resolution they are expressed in.
type NominalSeed = {
  readonly intrinsics: CameraIntrinsics;
  readonly imageWidth: number;
  readonly imageHeight: number;
};

/**
 * Calibrate a fisheye camera from board observations. Supply `options.initialGuess`
 * with the capture resolution (and a measured focal if known) to widen the
 * convergence basin; otherwise a coarse focal is derived from the detections.
 */
export function calibrate(
  views: ReadonlyArray<BoardObservation>,
  options?: CalibrationOptions,
): CalibrationResult {
  const validated = validateViews(views);
  if (validated.kind !== 'ok') return { kind: 'failed', reason: validated.reason };
  const nominal = resolveNominal(validated, options);
  const seed = seedCalibration({
    boardPoints: validated.boardPoints,
    imagePointsPerView: validated.imagePointsPerView,
    nominalIntrinsics: nominal.intrinsics,
  });
  if (seed.kind !== 'ok') return { kind: 'failed', reason: 'rank-deficient' };
  return solveCalibration(
    validated,
    packParams(seed.guess.intrinsics, seed.guess.distortion, seed.guess.views),
    options,
    nominal,
  );
}

function validateViews(
  views: ReadonlyArray<BoardObservation>,
):
  | (ValidatedViews & { readonly kind: 'ok' })
  | { readonly kind: 'failed'; readonly reason: CalibrationFailure } {
  if (views.length < MIN_VIEWS) return { kind: 'failed', reason: 'too-few-views' };
  const first = views[0];
  if (first === undefined || first.objectPoints.length < MIN_POINTS_PER_VIEW) {
    return { kind: 'failed', reason: 'too-few-points' };
  }
  const boardPoints = first.objectPoints;
  const imagePointsPerView: Array<ReadonlyArray<Vec2 | null>> = [];
  for (const view of views) {
    const lengthsMatch =
      view.objectPoints.length === boardPoints.length &&
      view.imagePoints.length === boardPoints.length;
    const activeCount = view.imagePoints.filter((point) => point != null).length;
    if (!lengthsMatch || activeCount < MIN_POINTS_PER_VIEW)
      return { kind: 'failed', reason: 'too-few-points' };
    imagePointsPerView.push(view.imagePoints);
  }
  return { kind: 'ok', boardPoints, imagePointsPerView, numViews: views.length };
}

function resolveNominal(
  views: ValidatedViews,
  options: CalibrationOptions | undefined,
): NominalSeed {
  const guess = options?.initialGuess;
  if (guess !== undefined) {
    const fx = guess.fx ?? NOMINAL_FOCAL_FRACTION * guess.imageWidth;
    return {
      intrinsics: {
        fx,
        fy: guess.fy ?? fx,
        cx: guess.cx ?? guess.imageWidth / 2,
        cy: guess.cy ?? guess.imageHeight / 2,
      },
      imageWidth: guess.imageWidth,
      imageHeight: guess.imageHeight,
    };
  }
  return nominalFromDetections(views.imagePointsPerView);
}

// Without a supplied resolution, estimate the frame from the detection bounding box:
// the corners roughly span the image, so its extent is the best available WxH to
// express the intrinsics in. Approximate, but keeps the result self-describing.
function nominalFromDetections(
  imagePointsPerView: ReadonlyArray<ReadonlyArray<Vec2 | null>>,
): NominalSeed {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const detections of imagePointsPerView) {
    for (const detection of detections) {
      if (detection == null) continue;
      minX = Math.min(minX, detection.x);
      maxX = Math.max(maxX, detection.x);
      minY = Math.min(minY, detection.y);
      maxY = Math.max(maxY, detection.y);
    }
  }
  const imageWidth = Math.max(maxX - minX, 1);
  const imageHeight = Math.max(maxY - minY, 1);
  const span = Math.max(imageWidth, imageHeight);
  return {
    intrinsics: {
      fx: NOMINAL_FOCAL_FRACTION * span,
      fy: NOMINAL_FOCAL_FRACTION * span,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    },
    imageWidth,
    imageHeight,
  };
}

function solveCalibration(
  views: ValidatedViews,
  seedParams: number[],
  options: CalibrationOptions | undefined,
  nominal: NominalSeed,
): CalibrationResult {
  const ctx: ResidualContext = {
    boardPoints: views.boardPoints,
    imagePointsPerView: views.imagePointsPerView,
    numViews: views.numViews,
  };
  const mask = buildActiveMask(ctx);
  const lm = levenbergMarquardt(
    (params) => computeResiduals(params, ctx, mask),
    seedParams,
    lmOptions(options),
  );
  if (lm.kind !== 'ok')
    return {
      kind: 'failed',
      reason: lm.reason === 'singular-system' ? 'rank-deficient' : 'no-convergence',
    };
  // OpenCV-aligned: a fit that ran out of iterations is still returned (best effort);
  // the wizard's trust check (assessCalibrationTrust), not the solver, judges usability.
  // 'no-convergence' remains for a genuinely blown-up (non-finite) LM run only.
  const solved = unpackParams(lm.params, views.numViews);
  if (solved.kind !== 'ok') return { kind: 'failed', reason: 'no-convergence' };
  const residuals = computeResiduals(lm.params, ctx, mask);
  const rms = perCornerRms(residuals, mask, views.numViews, views.boardPoints.length);
  return {
    kind: 'ok',
    intrinsics: solved.intrinsics,
    distortion: solved.distortion,
    imageWidth: nominal.imageWidth,
    imageHeight: nominal.imageHeight,
    views: solved.views,
    perViewRmsPx: rms.perView,
    rmsPx: rms.overall,
    iterations: lm.iterations,
    converged: lm.converged,
    exit: lm.exit,
    coverage: quadrantCoverage(
      views.imagePointsPerView,
      solved.intrinsics.cx,
      solved.intrinsics.cy,
    ),
  };
}

function lmOptions(options: CalibrationOptions | undefined): LevMarOptions {
  return {
    maxIterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
    ...(options?.distortionModel === 'k1k2' ? { fixedIndices: K3_K4_PARAM_INDICES } : {}),
    ...(options?.tolerance !== undefined
      ? { costTolerance: options.tolerance, stepTolerance: options.tolerance }
      : {}),
  };
}
