// Relief cutter geometry is physical: its circular footprint, raster cells,
// and stepover distances must be resolved after object XY scale. Split the
// transform into positive axis magnitudes used by heightmap planning and a
// residual isometry used to place the finished cutter-center paths.

import type { Transform } from '../scene';

export type ReliefMachineSpaceTransform = {
  readonly targetScaleX: number;
  readonly targetScaleY: number;
  readonly residualTransform: Transform;
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

function planningScale(scale: number): number {
  // Saved projects require finite scale, and interactive handles clamp away
  // from zero. Retain the legacy collapsed-axis behavior for a hand-built or
  // old zero-scale scene instead of turning this geometry correction into a
  // new compile refusal. Non-finite values remain in the residual transform
  // so the existing non-finite output integrity checks still catch them.
  return Number.isFinite(scale) && scale !== 0 ? Math.abs(scale) : 1;
}
