import type { Vec3 } from '../geometry/vec3';

const QUADRATIC_EPSILON_MM2 = 1e-14;

export type VCarveEmittedCapsule = {
  readonly a: Vec3;
  readonly b: Vec3;
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/** Build expanded swept-cone capsules for an emitted V-carve profile. */
export function buildVCarveEmittedCapsules(
  points: ReadonlyArray<Vec3>,
  tanHalf: number,
  toleranceMm: number,
): ReadonlyArray<VCarveEmittedCapsule> {
  const capsules: VCarveEmittedCapsule[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    const radius = Math.max(-a.z * tanHalf, -b.z * tanHalf, 0) + toleranceMm;
    capsules.push({
      a,
      b,
      minX: Math.min(a.x, b.x) - radius,
      minY: Math.min(a.y, b.y) - radius,
      maxX: Math.max(a.x, b.x) + radius,
      maxY: Math.max(a.y, b.y) + radius,
    });
  }
  return capsules;
}

/** Test whether an expanded emitted capsule contains a complete reference chord. */
export function vcarveCapsuleContainsChord(
  capsule: VCarveEmittedCapsule,
  a: Vec3,
  b: Vec3,
  tanHalf: number,
  toleranceMm: number,
): boolean {
  if (
    !vcarveDiskFitsCapsuleBounds(a, capsule, tanHalf) ||
    !vcarveDiskFitsCapsuleBounds(b, capsule, tanHalf)
  ) {
    return false;
  }
  return (
    diskContainedInChord(a, capsule.a, capsule.b, tanHalf, toleranceMm) &&
    diskContainedInChord(b, capsule.a, capsule.b, tanHalf, toleranceMm)
  );
}

/** Cheaply test whether a reference disk fits an emitted capsule's bounds. */
export function vcarveDiskFitsCapsuleBounds(
  point: Vec3,
  capsule: VCarveEmittedCapsule,
  tanHalf: number,
): boolean {
  const radius = Math.max(0, -point.z * tanHalf);
  return (
    point.x - radius >= capsule.minX &&
    point.x + radius <= capsule.maxX &&
    point.y - radius >= capsule.minY &&
    point.y + radius <= capsule.maxY
  );
}

function diskContainedInChord(
  point: Vec3,
  a: Vec3,
  b: Vec3,
  tanHalf: number,
  toleranceMm: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const radiusA = Math.max(0, -a.z * tanHalf);
  const radiusDelta = Math.max(0, -b.z * tanHalf) - radiusA;
  const pointRadius = Math.max(0, -point.z * tanHalf);
  const marginAtZero = radiusA + toleranceMm - pointRadius;
  const interval = nonnegativeLinearInterval(marginAtZero, radiusDelta);
  if (interval === null) return false;
  const qx = point.x - a.x;
  const qy = point.y - a.y;
  const quadratic = dx * dx + dy * dy - radiusDelta * radiusDelta;
  const linear = -2 * (qx * dx + qy * dy + marginAtZero * radiusDelta);
  const constant = qx * qx + qy * qy - marginAtZero * marginAtZero;
  let minimum = Math.min(
    quadraticAt(quadratic, linear, constant, interval.low),
    quadraticAt(quadratic, linear, constant, interval.high),
  );
  if (quadratic > 0) {
    const vertex = -linear / (2 * quadratic);
    if (vertex > interval.low && vertex < interval.high) {
      minimum = Math.min(minimum, quadraticAt(quadratic, linear, constant, vertex));
    }
  }
  return minimum <= QUADRATIC_EPSILON_MM2;
}

function nonnegativeLinearInterval(
  valueAtZero: number,
  slope: number,
): { readonly low: number; readonly high: number } | null {
  if (Math.abs(slope) <= Number.EPSILON) {
    return valueAtZero >= 0 ? { low: 0, high: 1 } : null;
  }
  const zero = -valueAtZero / slope;
  const low = slope > 0 ? Math.max(0, zero) : 0;
  const high = slope > 0 ? 1 : Math.min(1, zero);
  return low <= high ? { low, high } : null;
}

function quadraticAt(a: number, b: number, c: number, t: number): number {
  return (a * t + b) * t + c;
}
