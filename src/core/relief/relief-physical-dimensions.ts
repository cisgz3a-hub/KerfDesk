// Relief width is authored separately from the scene transform. CAM resolves
// finite non-zero XY scale into positive planning magnitudes before applying
// the residual mirror/rotation/translation. User-facing relief dimensions must
// use the same factorization or a transformed relief can report a width that
// differs from the surface CAM materializes.

import type { ReliefObject } from '../scene';
import { reliefMachineSpacePlanningWidthMm } from '../cnc/relief-machine-space-planning-width';

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
  const planningWidthMm = reliefMachineSpacePlanningWidthMm(relief);
  return {
    widthMm: planningWidthMm * targetScaleX,
    heightMm: planningWidthMm * aspect * targetScaleY,
    targetScaleX,
    targetScaleY,
  };
}

function reliefSourceAspect(relief: ReliefObject): number {
  if (relief.reliefSource.kind === 'heightfield-v1') {
    return relief.reliefSource.physicalHeightMm / relief.reliefSource.physicalWidthMm;
  }
  return meshSourceAspect(relief.reliefSource.meshPositions);
}

const meshAspectByPositions = new WeakMap<object, number>();

function meshSourceAspect(positions: ReadonlyArray<number> | Float32Array | Float64Array): number {
  const cached = meshAspectByPositions.get(positions);
  if (cached !== undefined) return cached;

  // meshToHeightmap keeps ordinary durable JSON numbers in Float32 but promotes
  // the whole mesh when any finite coordinate would overflow. Mirror that
  // precision without allocating a second full mesh on the browser thread.
  const retainBinary64 = retainsBinary64Coordinates(positions);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = meshCoordinate(positions[i] ?? 0, retainBinary64);
    const y = meshCoordinate(positions[i + 1] ?? 0, retainBinary64);
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

function retainsBinary64Coordinates(
  positions: ReadonlyArray<number> | Float32Array | Float64Array,
): boolean {
  if (positions instanceof Float64Array) return true;
  if (positions instanceof Float32Array) return false;
  for (const value of positions) {
    if (Number.isFinite(value) && !Number.isFinite(Math.fround(value))) return true;
  }
  return false;
}

function meshCoordinate(value: number, retainBinary64: boolean): number {
  return retainBinary64 ? value : Math.fround(value);
}
