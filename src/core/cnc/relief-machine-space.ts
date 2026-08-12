// Relief cutter geometry is physical: its circular footprint, raster cells,
// and stepover distances must be resolved after object XY scale. Split the
// transform into positive axis magnitudes used by heightmap planning and a
// residual isometry used to place the finished cutter-center paths.

import type { ReliefObject, Transform } from '../scene';
import {
  reliefPhysicalDimensions,
  reliefPlanningScale,
} from '../relief/relief-physical-dimensions';

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
  const targetScaleX = reliefPlanningScale(transform.scaleX);
  const targetScaleY = reliefPlanningScale(transform.scaleY);
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
  const physical = reliefPhysicalDimensions(relief);
  return {
    ...machineSpace,
    widthMm: physical.widthMm,
    heightMm: physical.heightMm,
  };
}
