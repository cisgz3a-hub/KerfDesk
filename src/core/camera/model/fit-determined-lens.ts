// Fit only the lens terms the points pin down (ADR-441 Amendment 4). Rings on
// part of the picture fit four distortion terms as well as they fit the true
// lens, and the extra terms then bend the model wildly outside the rings: a
// 300 mm target on a 400 mm bed gave terms up to 2.0 whose own uncertainty
// was several times larger, and a polynomial that turned back before the
// picture's corner. Bouguet's calibration toolbox advises that when "the
// uncertainty is much larger than the absolute value of the coefficient ...
// it is preferable to disable its estimation". So after each fit the highest
// free term is dropped while its sigma exceeds its size, and a lens that folds
// back inside the picture is refitted with fewer terms; k1 always stays free.
// Pure core.

import { fisheyeFoldRadius } from '../fisheye';
import type { LensModel } from './camera-model';
import {
  fitCameraModel,
  type CameraFit,
  type CameraFitFailure,
  type FitOptions,
  type ObservedView,
} from './fit-camera-model';

export type LensFitFailure = {
  readonly kind: 'failed';
  /** Even k1 alone bends the lens back inside the picture. */
  readonly reason: 'lens-folds';
};

// Index of k1 in CameraFit.lensSigma: [f, aspect, cx, cy, k1..k4].
const SIGMA_K1 = 4;
const FEWER_TERMS = [4, 3, 2, 1] as const;

/**
 * {@link fitCameraModel} with at most `options.distortionTerms` terms, as few
 * as the points need. When dropping an undetermined term leaves a lens that
 * folds inside the picture, the last fit that did not fold is kept; when
 * every fit folds, the calibration fails.
 */
export function fitDeterminedLens(
  views: ReadonlyArray<ObservedView>,
  options: FitOptions,
): CameraFit | CameraFitFailure | LensFitFailure {
  const most = options.distortionTerms ?? 4;
  if (options.fixedLens !== undefined || most === 0) return fitCameraModel(views, options);
  let unfolded: CameraFit | null = null;
  for (const terms of FEWER_TERMS.filter((count) => count <= most)) {
    const fit = fitCameraModel(views, { ...options, distortionTerms: terms });
    if (fit.kind === 'failed') return unfolded ?? fit;
    if (lensFoldsInPicture(fit.lens)) continue;
    if (terms === 1 || determined(fit, terms)) return fit;
    unfolded = fit;
  }
  return unfolded ?? { kind: 'failed', reason: 'lens-folds' };
}

/**
 * True when the lens polynomial turns back before the farthest picture
 * corner: pixels past the turn have no ray, and bed points beyond it are
 * drawn back onto pixels inside the picture.
 */
export function lensFoldsInPicture(lens: LensModel): boolean {
  const fold = fisheyeFoldRadius(lens.distortion);
  if (fold === null) return false;
  const { fx, fy, cx, cy } = lens.intrinsics;
  const right = lens.imageWidth - 1;
  const bottom = lens.imageHeight - 1;
  const corners = [
    [0, 0],
    [right, 0],
    [0, bottom],
    [right, bottom],
  ] as const;
  return corners.some(([u, v]) => Math.hypot((u - cx) / fx, (v - cy) / fy) >= fold);
}

// The highest free term is pinned down when its one-sigma uncertainty is
// smaller than the term itself. An unknown sigma (a singular fit) is not.
function determined(fit: CameraFit, terms: 1 | 2 | 3 | 4): boolean {
  const sigma = fit.lensSigma[SIGMA_K1 + terms - 1] ?? Number.NaN;
  const value = fit.lens.distortion[terms - 1] ?? 0;
  return sigma <= Math.abs(value);
}
