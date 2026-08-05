import type { Vec3 } from '../geometry/vec3';
import {
  buildVCarveEmittedCapsules,
  vcarveCapsuleContainsChord,
  type VCarveEmittedCapsule,
} from './vcarve-emitted-profile-capsule';
import {
  MAX_COVERAGE_CAPSULE_CHECKS,
  MAX_REFERENCE_SUBDIVISION_DEPTH,
} from './vcarve-emitted-profile-coverage';
import type { RadialEnvelope } from './radial-envelope';

type CoverageWork = { remaining: number };

/** Exact one-chord specialization of the general emitted-profile certificate. */
export function vcarveEmittedChordCoversProfileSpan(
  reference: ReadonlyArray<Vec3>,
  start: number,
  end: number,
  a: Vec3,
  b: Vec3,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  const capsule = buildVCarveEmittedCapsules([a, b], envelope, toleranceMm)[0];
  if (capsule === undefined) return false;
  const work: CoverageWork = { remaining: MAX_COVERAGE_CAPSULE_CHECKS };
  for (let index = start + 1; index <= end; index += 1) {
    const from = reference[index - 1];
    const to = reference[index];
    if (from === undefined || to === undefined) continue;
    if (!referenceChordCoveredByCapsule(from, to, capsule, envelope, toleranceMm, work)) {
      return false;
    }
  }
  return true;
}

function referenceChordCoveredByCapsule(
  a: Vec3,
  b: Vec3,
  capsule: VCarveEmittedCapsule,
  envelope: RadialEnvelope,
  toleranceMm: number,
  work: CoverageWork,
): boolean {
  const pending: Array<{ readonly a: Vec3; readonly b: Vec3; readonly depth: number }> = [
    { a, b, depth: 0 },
  ];
  while (pending.length > 0) {
    const span = pending.pop();
    if (span === undefined) continue;
    work.remaining -= 1;
    if (work.remaining < 0) return false;
    if (vcarveCapsuleContainsChord(capsule, span.a, span.b, envelope, toleranceMm)) continue;
    if (work.remaining <= 0 || span.depth >= MAX_REFERENCE_SUBDIVISION_DEPTH) return false;
    const midpoint = interpolateVec3(span.a, span.b, 0.5);
    pending.push(
      { a: midpoint, b: span.b, depth: span.depth + 1 },
      { a: span.a, b: midpoint, depth: span.depth + 1 },
    );
  }
  return true;
}

function interpolateVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}
