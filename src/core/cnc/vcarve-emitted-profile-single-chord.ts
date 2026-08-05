import type { Vec3 } from '../geometry/vec3';
import {
  buildVCarveEmittedCapsule,
  vcarveCapsuleContainsChord,
  type VCarveEmittedCapsule,
} from './vcarve-emitted-profile-capsule';
import type { RadialEnvelope } from './radial-envelope';

export const MAX_VCARVE_COVERAGE_CAPSULE_CHECKS = 250_000;

/** Certify a complete reference against one already-built candidate capsule. */
export function vcarveEmittedReferenceFitsSingleCapsule(
  reference: ReadonlyArray<Vec3>,
  capsule: VCarveEmittedCapsule | undefined,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  return referenceRangeFitsSingleCapsule(
    reference,
    0,
    reference.length - 1,
    capsule,
    envelope,
    toleranceMm,
  );
}

/** Certify one compaction span without allocating sliced profile arrays. */
export function vcarveEmittedSpanFitsChord(
  reference: ReadonlyArray<Vec3>,
  start: number,
  end: number,
  a: Vec3,
  b: Vec3,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  return referenceRangeFitsSingleCapsule(
    reference,
    start,
    end,
    buildVCarveEmittedCapsule(a, b, envelope, toleranceMm),
    envelope,
    toleranceMm,
  );
}

function referenceRangeFitsSingleCapsule(
  reference: ReadonlyArray<Vec3>,
  start: number,
  end: number,
  capsule: VCarveEmittedCapsule | undefined,
  envelope: RadialEnvelope,
  toleranceMm: number,
): boolean {
  if (
    capsule === undefined ||
    start < 0 ||
    end >= reference.length ||
    end <= start ||
    end - start > MAX_VCARVE_COVERAGE_CAPSULE_CHECKS
  ) {
    return false;
  }
  for (let index = start + 1; index <= end; index += 1) {
    const a = reference[index - 1];
    const b = reference[index];
    if (
      a !== undefined &&
      b !== undefined &&
      !vcarveCapsuleContainsChord(capsule, a, b, envelope, toleranceMm)
    ) {
      return false;
    }
  }
  return true;
}
