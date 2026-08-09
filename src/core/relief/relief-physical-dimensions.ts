// Relief width is authored separately from the scene transform. CAM resolves
// finite non-zero XY scale into positive planning magnitudes before applying
// the residual mirror/rotation/translation. User-facing relief dimensions must
// use the same factorization or a transformed relief can report a width that
// differs from the surface CAM materializes.

import type { ReliefObject } from '../scene';

export type ReliefPhysicalDimensions = {
  readonly widthMm: number;
  readonly heightMm: number;
  readonly targetScaleX: number;
  readonly targetScaleY: number;
};

/** Positive axis magnitude CAM applies while materializing a relief heightmap. */
export function reliefPlanningScale(scale: number): number {
  // Saved projects require finite scale, and interactive handles clamp away
  // from zero. Retain the legacy collapsed-axis behavior for hand-built or old
  // zero-scale scenes instead of turning this display correction into a new
  // refusal. Non-finite residual scale still reaches output integrity checks.
  return Number.isFinite(scale) && scale !== 0 ? Math.abs(scale) : 1;
}

/** Local physical dimensions of the relief surface CAM plans before placement. */
export function reliefPhysicalDimensions(relief: ReliefObject): ReliefPhysicalDimensions {
  const targetScaleX = reliefPlanningScale(relief.transform.scaleX);
  const targetScaleY = reliefPlanningScale(relief.transform.scaleY);
  const aspect = reliefSourceAspect(relief);
  return {
    widthMm: relief.targetWidthMm * targetScaleX,
    heightMm: relief.targetWidthMm * aspect * targetScaleY,
    targetScaleX,
    targetScaleY,
  };
}

function reliefSourceAspect(relief: ReliefObject): number {
  if (relief.depthMap !== undefined) return relief.depthMap.height / relief.depthMap.width;
  return meshSourceAspect(relief.meshPositions);
}

const meshAspectByPositions = new WeakMap<object, number>();

function meshSourceAspect(positions: ReadonlyArray<number> | Float32Array): number {
  const cached = meshAspectByPositions.get(positions);
  if (cached !== undefined) return cached;

  // meshToHeightmap computes its bounds after the durable JSON numbers have
  // been converted to Float32. Mirror that precision without allocating a
  // second full mesh on the browser thread. Cache by the immutable positions
  // array so width edits that rebuild the ReliefObject do not rescan it.
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = Math.fround(positions[i] ?? 0);
    const y = Math.fround(positions[i + 1] ?? 0);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const aspect =
    positions.length >= 9 &&
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0
      ? height / width
      : 1;
  meshAspectByPositions.set(positions, aspect);
  return aspect;
}
