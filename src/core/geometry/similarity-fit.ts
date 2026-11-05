import { maxOf, minOf } from '../util';
export type FitPoint = { readonly x: number; readonly y: number };
export type FitPair = { readonly from: FitPoint; readonly to: FitPoint };
export type FittedSimilarity = {
  readonly scale: number;
  readonly rotationRad: number;
  readonly translation: FitPoint;
};
export type SimilarityFit = {
  readonly transform: FittedSimilarity;
  readonly residualsMm: ReadonlyArray<number>;
  readonly maxResidualMm: number;
  readonly rmsResidualMm: number;
};

const MIN_SPREAD_MM = 0.001;

export function fitSimilarity(
  pairs: ReadonlyArray<FitPair>,
):
  | { readonly ok: true; readonly fit: SimilarityFit }
  | { readonly ok: false; readonly reason: string } {
  if (pairs.length < 2) return failure('At least two point pairs are required.');
  if (pairs.some(({ from, to }) => !finitePoint(from) || !finitePoint(to))) {
    return failure('Similarity fit coordinates must be finite.');
  }
  const fromCenter = centroid(pairs.map(({ from }) => from));
  const toCenter = centroid(pairs.map(({ to }) => to));
  let denominator = 0;
  let real = 0;
  let imaginary = 0;
  for (const { from, to } of pairs) {
    const px = from.x - fromCenter.x;
    const py = from.y - fromCenter.y;
    const qx = to.x - toCenter.x;
    const qy = to.y - toCenter.y;
    denominator += px * px + py * py;
    real += px * qx + py * qy;
    imaginary += px * qy - py * qx;
  }
  if (!Number.isFinite(denominator) || sourceSpread(pairs) < MIN_SPREAD_MM) {
    return failure('Similarity fit source points must be distinct.');
  }
  const scale = Math.hypot(real, imaginary) / denominator;
  const rotationRad = Math.atan2(imaginary, real);
  if (!(scale > 0) || !Number.isFinite(scale) || !Number.isFinite(rotationRad)) {
    return failure('Similarity fit scale must be finite and positive.');
  }
  const centered = rotateScale(fromCenter, scale, rotationRad);
  const transform = {
    scale,
    rotationRad,
    translation: { x: toCenter.x - centered.x, y: toCenter.y - centered.y },
  };
  if (!finitePoint(transform.translation)) {
    return failure('Similarity fit transform exceeds the supported numeric range.');
  }
  const residualsMm = pairs.map(({ from, to }) => {
    const mapped = applyFittedSimilarity(from, transform);
    return Math.hypot(mapped.x - to.x, mapped.y - to.y);
  });
  if (residualsMm.some((value) => !Number.isFinite(value))) {
    return failure('Similarity fit residuals exceed the supported numeric range.');
  }
  const maxResidualMm = maxOf(residualsMm);
  const rmsResidualMm = Math.sqrt(
    residualsMm.reduce((sum, residual) => sum + residual * residual, 0) / residualsMm.length,
  );
  return { ok: true, fit: { transform, residualsMm, maxResidualMm, rmsResidualMm } };
}

export function applyFittedSimilarity(point: FitPoint, t: FittedSimilarity): FitPoint {
  const mapped = rotateScale(point, t.scale, t.rotationRad);
  return { x: mapped.x + t.translation.x, y: mapped.y + t.translation.y };
}

function rotateScale(point: FitPoint, scale: number, radians: number): FitPoint {
  const cosine = Math.cos(radians) * scale;
  const sine = Math.sin(radians) * scale;
  return { x: point.x * cosine - point.y * sine, y: point.x * sine + point.y * cosine };
}

function centroid(points: ReadonlyArray<FitPoint>): FitPoint {
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function finitePoint(point: FitPoint): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function sourceSpread(pairs: ReadonlyArray<FitPair>): number {
  const xs = pairs.map(({ from }) => from.x);
  const ys = pairs.map(({ from }) => from.y);
  return Math.hypot(maxOf(xs) - minOf(xs), maxOf(ys) - minOf(ys));
}

function failure(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}
