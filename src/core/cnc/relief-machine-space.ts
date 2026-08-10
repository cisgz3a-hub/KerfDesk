// Relief cutter geometry is physical: its circular footprint, raster cells,
// and stepover distances must be resolved after object XY scale. Split the
// transform into positive axis magnitudes used by heightmap planning and a
// residual isometry used to place the finished cutter-center paths.

import type { ReliefObject, Transform } from '../scene';
import { reliefMachineSpacePlanningWidthMm } from './relief-machine-space-planning-width';

export type ReliefMachineSpaceTransform = {
  readonly targetScaleX: number;
  readonly targetScaleY: number;
  readonly residualTransform: Transform;
};

export type ReliefMachineSpaceGeometry = ReliefMachineSpaceTransform & {
  readonly widthMm: number;
  readonly heightMm: number;
};

export function reliefMachineSpaceTransform(transform: Transform): ReliefMachineSpaceTransform {
  const targetScaleX = planningScale(transform.scaleX);
  const targetScaleY = planningScale(transform.scaleY);
  return {
    targetScaleX,
    targetScaleY,
    residualTransform: {
      ...transform,
      scaleX: transform.scaleX / targetScaleX,
      scaleY: transform.scaleY / targetScaleY,
    },
  };
}

/** Physical planning size and residual placement used by relief CAM and previews. */
export function reliefMachineSpaceGeometry(relief: ReliefObject): ReliefMachineSpaceGeometry {
  const machineSpace = reliefMachineSpaceTransform(relief.transform);
  return {
    ...machineSpace,
    widthMm: reliefMachineSpacePlanningWidthMm(relief) * machineSpace.targetScaleX,
    heightMm: reliefNaturalHeightMm(relief) * machineSpace.targetScaleY,
  };
}

function reliefNaturalHeightMm(relief: ReliefObject): number {
  if (relief.reliefSource.kind === 'heightfield-v1') {
    return relief.reliefSource.physicalHeightMm;
  }
  const sourceWidth = relief.bounds.maxX - relief.bounds.minX;
  const sourceHeight = relief.bounds.maxY - relief.bounds.minY;
  return sourceWidth > 0 && sourceHeight > 0
    ? relief.targetWidthMm * (sourceHeight / sourceWidth)
    : relief.targetWidthMm;
}

function planningScale(scale: number): number {
  // Saved projects require finite scale, and interactive handles clamp away
  // from zero. Retain the legacy collapsed-axis behavior for a hand-built or
  // old zero-scale scene instead of turning this geometry correction into a
  // new compile refusal. Non-finite values remain in the residual transform
  // so the existing non-finite output integrity checks still catch them.
  return Number.isFinite(scale) && scale !== 0 ? Math.abs(scale) : 1;
}
