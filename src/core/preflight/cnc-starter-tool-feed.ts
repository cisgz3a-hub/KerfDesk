import {
  cncStarterMatchesTool,
  findCncMachineStarterById,
} from '../cnc/cnc-machine-starter-catalog';
import { layerCncTool, type CncMachineConfig, type Layer } from '../scene';
import type { PreflightIssue } from './preflight';

/** Retained machine-starter values are not a qualification for another cutter. */
export function cncStarterToolFeedIssue(
  layer: Layer,
  machine: CncMachineConfig,
): PreflightIssue | null {
  const settings = layer.cnc;
  const source = settings?.feedSource;
  if (settings === undefined || source?.kind !== 'machine-starter') return null;
  const starter = findCncMachineStarterById(source.starterId);
  const tool = layerCncTool(machine, settings);
  if (starter === null || cncStarterMatchesTool(starter, tool)) return null;
  return {
    code: 'cnc-starter-tool-feed-retained',
    message:
      `Layer ${layer.id}: bit "${tool.name}" (${tool.diameterMm} mm) retains values from ` +
      `the ${starter.tool.diameterMm} mm, ${starter.tool.fluteCount}-flute machine starter: ` +
      `feed ${settings.feedMmPerMin} mm/min, plunge ${settings.plungeMmPerMin} mm/min, ` +
      `${settings.spindleRpm} RPM, ${settings.depthPerPassMm} mm/pass. ` +
      'Choose a material recipe or verify these values for the fitted bit before cutting.',
  };
}
