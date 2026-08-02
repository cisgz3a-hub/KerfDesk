import type { Vec3 } from '../geometry/vec3';
import {
  buildVCarveEmittedCapsules,
  vcarveCapsuleContainsChord,
  vcarveDiskFitsCapsuleBounds,
  type VCarveEmittedCapsule,
} from './vcarve-emitted-profile-capsule';
import {
  buildVCarveProfileDistanceIndex,
  mappedVCarveProfileCapsuleIndex,
  type VCarveProfileDistanceIndex,
} from './vcarve-profile-distance-index';

const MAX_REFERENCE_SUBDIVISION_DEPTH = 12;
const MAX_COVERAGE_CAPSULE_CHECKS = 250_000;
const MAX_DISTANCE_INDEX_RADIUS = 8;

type CoverageWork = { remaining: number };

/**
 * Certify a compact emitted profile against an unsimplified emitted
 * reference. Every reference chord capsule must fit inside one expanded
 * candidate chord capsule. One capsule is convex, so containing both endpoint
 * disks also contains the complete variable-radius reference chord between
 * them.
 */
export function vcarveEmittedProfileCovers(
  reference: ReadonlyArray<Vec3>,
  candidate: ReadonlyArray<Vec3>,
  tanHalf: number,
  toleranceMm: number,
): boolean {
  if (reference.length < 2 || candidate.length < 2) return reference.length === candidate.length;
  const capsules = buildVCarveEmittedCapsules(candidate, tanHalf, toleranceMm);
  const referenceDistance = buildVCarveProfileDistanceIndex(reference);
  const candidateDistance = buildVCarveProfileDistanceIndex(candidate);
  const work: CoverageWork = { remaining: MAX_COVERAGE_CAPSULE_CHECKS };
  let capsuleHint = 0;
  for (let index = 1; index < reference.length; index += 1) {
    const a = reference[index - 1];
    const b = reference[index];
    if (a === undefined || b === undefined) continue;
    const distanceA = referenceDistance.cumulativeMm[index - 1] ?? 0;
    const distanceB = referenceDistance.cumulativeMm[index] ?? distanceA;
    const covered = referenceChordCovered(
      a,
      b,
      distanceA,
      distanceB,
      capsules,
      referenceDistance,
      candidateDistance,
      tanHalf,
      toleranceMm,
      capsuleHint,
      work,
    );
    if (covered === null) return false;
    capsuleHint = covered;
  }
  return true;
}

function referenceChordCovered(
  a: Vec3,
  b: Vec3,
  distanceA: number,
  distanceB: number,
  capsules: ReadonlyArray<VCarveEmittedCapsule>,
  referenceDistance: VCarveProfileDistanceIndex,
  candidateDistance: VCarveProfileDistanceIndex,
  tanHalf: number,
  toleranceMm: number,
  initialHint: number,
  work: CoverageWork,
): number | null {
  const pending: Array<{
    readonly a: Vec3;
    readonly b: Vec3;
    readonly distanceA: number;
    readonly distanceB: number;
    readonly depth: number;
  }> = [{ a, b, distanceA, distanceB, depth: 0 }];
  let hint = initialHint;
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined) continue;
    const match = matchingCapsule(
      span.a,
      span.b,
      (span.distanceA + span.distanceB) / 2,
      capsules,
      referenceDistance,
      candidateDistance,
      tanHalf,
      toleranceMm,
      hint,
      work,
    );
    if (match !== null) {
      hint = match;
      continue;
    }
    if (work.remaining <= 0) return null;
    if (span.depth >= MAX_REFERENCE_SUBDIVISION_DEPTH) {
      const globalMatch = matchingCapsuleByBounds(
        span.a,
        span.b,
        capsules,
        tanHalf,
        toleranceMm,
        work,
      );
      if (globalMatch === null) return null;
      hint = globalMatch;
      continue;
    }
    const midpoint = interpolateVec3(span.a, span.b, 0.5);
    const midpointDistance = (span.distanceA + span.distanceB) / 2;
    pending.push(
      {
        a: midpoint,
        b: span.b,
        distanceA: midpointDistance,
        distanceB: span.distanceB,
        depth: span.depth + 1,
      },
      {
        a: span.a,
        b: midpoint,
        distanceA: span.distanceA,
        distanceB: midpointDistance,
        depth: span.depth + 1,
      },
    );
  }
  return hint;
}

function matchingCapsule(
  a: Vec3,
  b: Vec3,
  referenceDistanceMm: number,
  capsules: ReadonlyArray<VCarveEmittedCapsule>,
  referenceDistance: VCarveProfileDistanceIndex,
  candidateDistance: VCarveProfileDistanceIndex,
  tanHalf: number,
  toleranceMm: number,
  hint: number,
  work: CoverageWork,
): number | null {
  const mapped = mappedVCarveProfileCapsuleIndex(
    referenceDistanceMm,
    referenceDistance,
    candidateDistance,
  );
  for (const center of mapped === hint ? [mapped] : [mapped, hint]) {
    const match = matchingCapsuleNear(a, b, capsules, tanHalf, toleranceMm, center, work);
    if (match !== null) return match;
  }
  return null;
}

function matchingCapsuleNear(
  a: Vec3,
  b: Vec3,
  capsules: ReadonlyArray<VCarveEmittedCapsule>,
  tanHalf: number,
  toleranceMm: number,
  center: number,
  work: CoverageWork,
): number | null {
  const start = Math.max(0, center - MAX_DISTANCE_INDEX_RADIUS);
  const end = Math.min(capsules.length, center + MAX_DISTANCE_INDEX_RADIUS + 1);
  for (let index = start; index < end; index += 1) {
    work.remaining -= 1;
    if (work.remaining < 0) return null;
    const capsule = capsules[index];
    if (capsule !== undefined && vcarveCapsuleContainsChord(capsule, a, b, tanHalf, toleranceMm)) {
      return index;
    }
  }
  return null;
}

// Repeated edge-cover geometry can make cumulative distance drift beyond the
// local index window. Only a span that has already reached the subdivision
// limit pays this full scan; cheap disk bounds discard remote capsules before
// an exact quadratic containment check consumes certificate work.
function matchingCapsuleByBounds(
  a: Vec3,
  b: Vec3,
  capsules: ReadonlyArray<VCarveEmittedCapsule>,
  tanHalf: number,
  toleranceMm: number,
  work: CoverageWork,
): number | null {
  for (let index = 0; index < capsules.length; index += 1) {
    const capsule = capsules[index];
    if (
      capsule === undefined ||
      !vcarveDiskFitsCapsuleBounds(a, capsule, tanHalf) ||
      !vcarveDiskFitsCapsuleBounds(b, capsule, tanHalf)
    ) {
      continue;
    }
    work.remaining -= 1;
    if (work.remaining < 0) return null;
    if (vcarveCapsuleContainsChord(capsule, a, b, tanHalf, toleranceMm)) return index;
  }
  return null;
}

function interpolateVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
