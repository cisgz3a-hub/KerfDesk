import type { Vec3 } from '../geometry/vec3';
import type { CncPass } from '../job';
import type { BoundarySegment } from './vcarve-detail-geometry';
import { zPassDepths } from './depth-passes';
import { compactVCarveEmittedProfile } from './vcarve-emitted-profile-compaction';
import { vcarveEmittedProfileCovers } from './vcarve-emitted-profile';

type DepthSteppedOptions = {
  readonly depthPerPassMm: number;
  readonly tanHalf: number;
  readonly compactionToleranceMm: number;
  readonly sweepToleranceMm: number;
};

/** Build and independently certify every emitted depth level. */
export function certifiedVCarveDepthSteppedPasses(
  candidate: ReadonlyArray<Vec3>,
  reference: ReadonlyArray<Vec3>,
  closed: boolean,
  segments: ReadonlyArray<BoundarySegment>,
  options: DepthSteppedOptions,
): ReadonlyArray<CncPass> {
  let deepest = 0;
  for (const point of reference) deepest = Math.min(deepest, point.z);
  if (!(deepest < 0)) return [];
  return zPassDepths(-deepest, options.depthPerPassMm).map((levelZ) => ({
    kind: 'path3d' as const,
    points: certifiedLevel(candidate, reference, levelZ, segments, options),
    closed,
    lateralFeed: 'z-rate-capped' as const,
  }));
}

function certifiedLevel(
  candidate: ReadonlyArray<Vec3>,
  reference: ReadonlyArray<Vec3>,
  levelZ: number,
  segments: ReadonlyArray<BoundarySegment>,
  options: DepthSteppedOptions,
): ReadonlyArray<Vec3> {
  const candidateLevel = pointsAtLevel(candidate, levelZ);
  const referenceLevel = pointsAtLevel(reference, levelZ);
  const compact = compactVCarveEmittedProfile(
    candidateLevel,
    segments,
    options.tanHalf,
    options.compactionToleranceMm,
  );
  if (covers(referenceLevel, compact, options)) return compact;
  if (covers(referenceLevel, candidateLevel, options)) return candidateLevel;
  const compactReference = compactVCarveEmittedProfile(
    referenceLevel,
    segments,
    options.tanHalf,
    options.compactionToleranceMm,
  );
  return covers(referenceLevel, compactReference, options) ? compactReference : referenceLevel;
}

function covers(
  reference: ReadonlyArray<Vec3>,
  candidate: ReadonlyArray<Vec3>,
  options: DepthSteppedOptions,
): boolean {
  return vcarveEmittedProfileCovers(
    reference,
    candidate,
    options.tanHalf,
    options.sweepToleranceMm,
  );
}

function pointsAtLevel(points: ReadonlyArray<Vec3>, levelZ: number): ReadonlyArray<Vec3> {
  return points.map((point) => ({ ...point, z: Math.max(point.z, levelZ) }));
}
