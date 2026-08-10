import {
  reliefMachineSpaceGeometry,
  type ReliefMachineSpaceGeometry,
} from '../../../core/cnc/relief-machine-space';
import { reliefMachineSpacePlanningWidthMm } from '../../../core/cnc/relief-machine-space-planning-width';
import type { ReliefObject } from '../../../core/scene';
import {
  relief3dDisplayResolution,
  type Relief3DDisplayResolution,
} from '../relief3d-display-resolution';

/** Resolved inputs for one Relief 3D dialog build. */
export type Relief3DViewerDialogPlan = {
  readonly machineSpace: ReliefMachineSpaceGeometry;
  readonly planningWidthMm: number;
  readonly resolution: Relief3DDisplayResolution;
  readonly title: string;
};

/** Resolve the shared Relief 3D dialog build plan. */
export function relief3dViewerDialogPlan(relief: ReliefObject): Relief3DViewerDialogPlan {
  const machineSpace = reliefMachineSpaceGeometry(relief);
  return {
    machineSpace,
    planningWidthMm: reliefMachineSpacePlanningWidthMm(relief),
    resolution: relief3dDisplayResolution(machineSpace.widthMm, machineSpace.heightMm),
    title: `${relief.source} — ${machineSpace.widthMm.toFixed(0)} mm wide × ${relief.reliefDepthMm.toFixed(1)} mm deep`,
  };
}
