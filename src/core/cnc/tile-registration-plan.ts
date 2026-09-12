import type { CncMachineConfig, CncTool } from '../scene';
import type { CncTileRegistration } from '../scene/machine';
import { zPassArrayMaterializationError } from './depth-passes';

export type ResolvedTileRegistration = {
  readonly settings: CncTileRegistration;
  readonly tool: CncTool;
};

const POSITIVE_REGISTRATION_FIELDS = [
  ['holeDiameterMm', 'hole diameter'],
  ['depthMm', 'depth'],
  ['depthPerPassMm', 'depth per pass'],
  ['feedMmPerMin', 'feed'],
  ['plungeMmPerMin', 'plunge feed'],
  ['spindleRpm', 'spindle speed'],
] as const;

/** Missing geometry/identity cannot describe the requested bore. No fallback
 * to another operation's cutter, depth or cutting values is permitted. */
export function resolveTileRegistration(
  registration: CncTileRegistration | undefined,
  machine: CncMachineConfig | undefined,
): ResolvedTileRegistration | string {
  if (registration === undefined || machine === undefined) {
    return 'Set a registration cutter, hole diameter, depth and depth per pass in Startup Setup > Tiling before exporting registration holes.';
  }
  const tool = machine.tools.find((candidate) => candidate.id === registration.toolId);
  if (tool === undefined)
    return 'Choose an existing registration cutter in Startup Setup > Tiling.';
  if (tool.kind !== 'end-mill')
    return 'Tile registration bores require a flat end mill; the selected cutter does not have the supported cylindrical removal model.';
  if (!Number.isFinite(tool.diameterMm) || tool.diameterMm <= 0)
    return 'The registration cutter needs a finite positive cutting diameter.';
  const fieldsError = positiveRegistrationFieldsError(registration);
  if (fieldsError !== null) return fieldsError;
  if (registration.holeDiameterMm < tool.diameterMm)
    return `The ${tool.diameterMm} mm registration cutter cannot produce a ${registration.holeDiameterMm} mm hole. Choose a smaller cutter or increase the hole diameter.`;
  const depthError = zPassArrayMaterializationError(
    registration.depthMm,
    registration.depthPerPassMm,
  );
  if (depthError !== null) return depthError;
  const rings = Math.ceil((registration.holeDiameterMm - tool.diameterMm) / tool.diameterMm);
  if (!Number.isFinite(rings) || rings > 0xffff_ffff)
    return 'The registration bore path exceeds the ECMAScript Array length limit.';
  return { settings: registration, tool };
}

function positiveRegistrationFieldsError(registration: CncTileRegistration): string | null {
  for (const [key, label] of POSITIVE_REGISTRATION_FIELDS) {
    if (!Number.isFinite(registration[key]) || registration[key] <= 0)
      return `Tile registration ${label} must be a finite positive number.`;
  }
  return null;
}
