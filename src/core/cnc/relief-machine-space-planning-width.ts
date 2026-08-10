import type { ReliefObject } from '../scene';

/** Resolve the unscaled Width authority shared by relief consumers. */
export function reliefMachineSpacePlanningWidthMm(relief: ReliefObject): number {
  return relief.reliefSource.kind === 'heightfield-v1' && relief.transform.scaleX !== 0
    ? relief.reliefSource.physicalWidthMm
    : relief.targetWidthMm;
}
