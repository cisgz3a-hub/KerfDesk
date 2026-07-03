// Reporting metrics for a solved fisheye calibration (ADR-108, v2.c): the per-corner
// reprojection RMS the operator trusts, and the per-quadrant corner coverage the
// wizard uses to coach the user toward an even capture. Pure core. Kept apart from
// calibrate.ts so the orchestrator stays inside the size limit.

import type { Vec2 } from '../scene';

/** Detected-corner count in one image quadrant, relative to the solved principal point. */
export type QuadrantCoverage = {
  readonly quadrant: 'tl' | 'tr' | 'bl' | 'br';
  readonly corners: number;
};

/** Reprojection RMS in pixels: overall, and one value per view. */
export type RmsReport = { readonly overall: number; readonly perView: number[] };

/**
 * Per-corner Euclidean reprojection RMS over the ACTIVE (detected) corners —
 * √(Σ(rx²+ry²)/activeCorners), matching the OpenCV/LightBurn convention — not the
 * minimiser's per-scalar value. Inactive corner pairs are skipped.
 */
export function perCornerRms(
  residuals: ReadonlyArray<number>,
  mask: ReadonlyArray<boolean>,
  numViews: number,
  cornerCount: number,
): RmsReport {
  const perView: number[] = [];
  let totalSquared = 0;
  let totalCount = 0;
  for (let view = 0; view < numViews; view += 1) {
    let squared = 0;
    let count = 0;
    for (let corner = 0; corner < cornerCount; corner += 1) {
      const base = 2 * (view * cornerCount + corner);
      if (mask[base] !== true) continue;
      const rx = residuals[base] ?? 0;
      const ry = residuals[base + 1] ?? 0;
      squared += rx * rx + ry * ry;
      count += 1;
    }
    perView.push(count > 0 ? Math.sqrt(squared / count) : 0);
    totalSquared += squared;
    totalCount += count;
  }
  return { overall: totalCount > 0 ? Math.sqrt(totalSquared / totalCount) : 0, perView };
}

/** Count detected corners per image quadrant about the solved principal point (cx, cy). */
export function quadrantCoverage(
  imagePointsPerView: ReadonlyArray<ReadonlyArray<Vec2 | null>>,
  cx: number,
  cy: number,
): QuadrantCoverage[] {
  let tl = 0;
  let tr = 0;
  let bl = 0;
  let br = 0;
  for (const detections of imagePointsPerView) {
    for (const detection of detections) {
      if (detection == null) continue;
      const left = detection.x < cx;
      if (detection.y < cy) {
        if (left) tl += 1;
        else tr += 1;
      } else if (left) bl += 1;
      else br += 1;
    }
  }
  return [
    { quadrant: 'tl', corners: tl },
    { quadrant: 'tr', corners: tr },
    { quadrant: 'bl', corners: bl },
    { quadrant: 'br', corners: br },
  ];
}
