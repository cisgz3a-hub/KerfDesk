import type { Vec3 } from '../geometry/vec3';
import { radialEnvelopeSweepRadiiMm, type RadialEnvelope } from './radial-envelope';

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
  envelope: RadialEnvelope,
  toleranceMm: number,
): ReadonlyArray<VCarveEmittedCapsule> {
  const capsules: VCarveEmittedCapsule[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a === undefined || b === undefined) continue;
    capsules.push(buildVCarveEmittedCapsule(a, b, envelope, toleranceMm));
  }
  return capsules;
}

/** Build one expanded swept-cone capsule without allocating a profile array. */
export function buildVCarveEmittedCapsule(
  a: Vec3,
  b: Vec3,
  envelope: RadialEnvelope,
  toleranceMm: number,
): VCarveEmittedCapsule {
  const [radiusA, radiusB] = radialEnvelopeSweepRadiiMm(envelope, -a.z, -b.z);
  const radius = Math.max(radiusA, radiusB) + toleranceMm;
  return {
    a,
    b,
    minX: Math.min(a.x, b.x) - radius,
    minY: Math.min(a.y, b.y) - radius,
    maxX: Math.max(a.x, b.x) + radius,
    maxY: Math.max(a.y, b.y) + radius,
  };
}

/** Test whether an expanded emitted capsule contains a complete reference chord. */
export function vcarveCapsuleContainsChord(
  capsule: VCarveEmittedCapsule,
  a: Vec3,
  b: Vec3,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  const [referenceRadiusA, referenceRadiusB] = radialEnvelopeSweepRadiiMm(envelope, -a.z, -b.z);
  const [capsuleRadiusA, capsuleRadiusB] = radialEnvelopeSweepRadiiMm(
    envelope,
    -capsule.a.z,
    -capsule.b.z,
  );
  if (
    !vcarveDiskFitsCapsuleBounds(a, referenceRadiusA, capsule) ||
    !vcarveDiskFitsCapsuleBounds(b, referenceRadiusB, capsule)
  ) {
    return false;
  }
  return (
    diskContainedInChord(
      a,
      referenceRadiusA,
      capsule.a,
      capsule.b,
      capsuleRadiusA,
      capsuleRadiusB,
      toleranceMm,
    ) &&
    diskContainedInChord(
      b,
      referenceRadiusB,
      capsule.a,
      capsule.b,
      capsuleRadiusA,
      capsuleRadiusB,
      toleranceMm,
    )
  );
}

/** Cheaply test whether a reference disk fits an emitted capsule's bounds. */
export function vcarveDiskFitsCapsuleBounds(
  point: Vec3,
  radius: number,
  capsule: VCarveEmittedCapsule,
): boolean {
  return (
    point.x - radius >= capsule.minX &&
    point.x + radius <= capsule.maxX &&
    point.y - radius >= capsule.minY &&
    point.y + radius <= capsule.maxY
  );
}

function diskContainedInChord(
  point: Vec3,
  pointRadius: number,
  a: Vec3,
  b: Vec3,
  radiusA: number,
  radiusB: number,
  toleranceMm: number,
): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const radiusDelta = radiusB - radiusA;
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
