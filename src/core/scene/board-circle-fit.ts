import type { Vec2 } from './scene-object';

const MIN_RIM_POINTS = 4;
const MIN_SPREAD_CONDITION = 0.02;
const MIN_ANGULAR_COVERAGE_DEG = 200;

export type BestFitCircle = {
  readonly center: Vec2;
  readonly radiusMm: number;
  readonly diameterMm: number;
  readonly rmsErrorMm: number;
  readonly maxErrorMm: number;
  readonly coverageDeg: number;
};

/**
 * Least-squares circle through four or more physical rim captures.
 *
 * The centred Kasa solve is deterministic and well-conditioned for points
 * spread around the blank. Clustered / effectively-collinear samples are
 * rejected: three points always define some circle, but the fourth point and
 * the coverage guard give the operator a meaningful capture-quality check.
 */
export function bestFitCircleFromRimPoints(points: ReadonlyArray<Vec2>): BestFitCircle | null {
  if (points.length < MIN_RIM_POINTS || !points.every(isFinitePoint)) return null;
  const mean = centroid(points);
  const center = solveCircleCenter(mean, circleFitMoments(points, mean));
  if (center === null) return null;
  const distances = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
  const radiusMm = distances.reduce((sum, value) => sum + value, 0) / distances.length;
  if (!Number.isFinite(radiusMm) || radiusMm <= 0) return null;
  const coverageDeg = angularCoverageDeg(points, center);
  if (coverageDeg < MIN_ANGULAR_COVERAGE_DEG) return null;
  const errors = distances.map((distance) => Math.abs(distance - radiusMm));
  const rmsErrorMm = Math.sqrt(
    errors.reduce((sum, error) => sum + error * error, 0) / errors.length,
  );
  const maxErrorMm = Math.max(...errors);
  if (!Number.isFinite(rmsErrorMm) || !Number.isFinite(maxErrorMm)) return null;

  return {
    center,
    radiusMm,
    diameterMm: radiusMm * 2,
    rmsErrorMm,
    maxErrorMm,
    coverageDeg,
  };
}

type CircleFitMoments = {
  readonly sxx: number;
  readonly sxy: number;
  readonly syy: number;
  readonly sxz: number;
  readonly syz: number;
};

function circleFitMoments(points: ReadonlyArray<Vec2>, mean: Vec2): CircleFitMoments {
  return points.reduce<CircleFitMoments>(
    (sum, point) => {
      const x = point.x - mean.x;
      const y = point.y - mean.y;
      const z = x * x + y * y;
      return {
        sxx: sum.sxx + x * x,
        sxy: sum.sxy + x * y,
        syy: sum.syy + y * y,
        sxz: sum.sxz + x * z,
        syz: sum.syz + y * z,
      };
    },
    { sxx: 0, sxy: 0, syy: 0, sxz: 0, syz: 0 },
  );
}

function solveCircleCenter(mean: Vec2, moments: CircleFitMoments): Vec2 | null {
  const { sxx, sxy, syy, sxz, syz } = moments;
  const trace = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  if (!wellSpread(trace, det)) return null;
  const localX = (sxz * syy - syz * sxy) / (2 * det);
  const localY = (syz * sxx - sxz * sxy) / (2 * det);
  const center = { x: mean.x + localX, y: mean.y + localY };
  return isFinitePoint(center) ? center : null;
}

function wellSpread(trace: number, determinant: number): boolean {
  if (!Number.isFinite(trace) || !Number.isFinite(determinant)) return false;
  if (trace <= 0 || determinant <= 0) return false;
  const condition = (4 * determinant) / (trace * trace);
  return Number.isFinite(condition) && condition >= MIN_SPREAD_CONDITION;
}

function centroid(points: ReadonlyArray<Vec2>): Vec2 {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), {
    x: 0,
    y: 0,
  });
  return { x: total.x / points.length, y: total.y / points.length };
}

function angularCoverageDeg(points: ReadonlyArray<Vec2>, center: Vec2): number {
  const angles = points
    .map((point) => Math.atan2(point.y - center.y, point.x - center.x))
    .sort((a, b) => a - b);
  let largestGap = 0;
  for (let index = 0; index < angles.length; index += 1) {
    const current = angles[index];
    const next = angles[(index + 1) % angles.length];
    if (current === undefined || next === undefined) return 0;
    const gap = index === angles.length - 1 ? next + Math.PI * 2 - current : next - current;
    largestGap = Math.max(largestGap, gap);
  }
  return ((Math.PI * 2 - largestGap) * 180) / Math.PI;
}

function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
