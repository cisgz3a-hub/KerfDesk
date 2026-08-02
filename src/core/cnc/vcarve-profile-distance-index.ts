import type { Vec3 } from '../geometry/vec3';

export type VCarveProfileDistanceIndex = {
  readonly cumulativeMm: ReadonlyArray<number>;
  readonly totalMm: number;
};

/** Index an emitted profile by cumulative XY travel, preserving repeated-route occurrence order. */
export function buildVCarveProfileDistanceIndex(
  points: ReadonlyArray<Vec3>,
): VCarveProfileDistanceIndex {
  const cumulativeMm = [0];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const previous = cumulativeMm[index - 1] ?? 0;
    cumulativeMm.push(
      a === undefined || b === undefined ? previous : previous + Math.hypot(b.x - a.x, b.y - a.y),
    );
  }
  return { cumulativeMm, totalMm: cumulativeMm.at(-1) ?? 0 };
}

/** Map reference progress to the corresponding ordered candidate capsule. */
export function mappedVCarveProfileCapsuleIndex(
  referenceDistanceMm: number,
  reference: VCarveProfileDistanceIndex,
  candidate: VCarveProfileDistanceIndex,
): number {
  if (!(reference.totalMm > 0) || !(candidate.totalMm > 0)) return 0;
  const mappedDistanceMm = (referenceDistanceMm / reference.totalMm) * candidate.totalMm;
  const cumulative = candidate.cumulativeMm;
  let low = 1;
  let high = Math.max(1, cumulative.length - 1);
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cumulative[middle] ?? candidate.totalMm) < mappedDistanceMm) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
