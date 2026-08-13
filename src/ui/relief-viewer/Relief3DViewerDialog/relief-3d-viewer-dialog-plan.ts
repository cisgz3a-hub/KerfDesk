import {
  reliefMachineSpaceGeometry,
  type ReliefMachineSpaceGeometry,
} from '../../../core/cnc/relief-machine-space';
import { reliefMachineSpacePlanningWidthMm } from '../../../core/cnc/relief-machine-space-planning-width';
// Deep import: core/relief's barrel is a ratcheted over-cap legacy barrel.
import { reliefPhysicalDimensions } from '../../../core/relief/relief-physical-dimensions';
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
  const physical = reliefPhysicalDimensions(relief);
  return {
    machineSpace,
    planningWidthMm: reliefMachineSpacePlanningWidthMm(relief),
    resolution: relief3dDisplayResolution(machineSpace.widthMm, machineSpace.heightMm),
    // #659: report the true physical width, not a rounded planning target.
    title: `${relief.source} \u2014 ${formatMm(physical.widthMm)} mm wide \u00d7 ${formatMm(relief.reliefDepthMm)} mm deep`,
  };
}

const RELIEF_TITLE_DECIMALS = 6;
function formatMm(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  return value.toFixed(RELIEF_TITLE_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
}