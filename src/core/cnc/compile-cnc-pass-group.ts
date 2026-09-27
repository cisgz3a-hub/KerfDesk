import type { DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncLayerSettings, CncMachineConfig, CncTool, Layer } from '../scene';
import { coolantFields } from './coolant-fields';
import {
  capFeed,
  capSpindle,
  resolveRetractBetweenPasses,
  type CncGroupCompileOptions,
} from './compile-cnc-helpers';
import { cncGroupProvenance } from './cnc-group-provenance';
import { parkFields } from './motion-polish';

export function cncGroupForPasses(
  layer: Layer,
  settings: CncLayerSettings,
  tool: CncTool,
  passes: ReadonlyArray<CncPass>,
  device: DeviceProfile,
  config: CncMachineConfig,
  options: CncGroupCompileOptions = {},
): CncGroup | null {
  if (passes.length === 0) return null;
  const cutFeed =
    settings.cutType === 'drill'
      ? Math.min(settings.feedMmPerMin, settings.plungeMmPerMin)
      : settings.feedMmPerMin;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: settings.cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    ...cncGroupProvenance(settings, tool, options),
    feedMmPerMin: capFeed(cutFeed, device.maxFeed),
    plungeMmPerMin: capFeed(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: capSpindle(settings.spindleRpm, config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    retractBetweenPasses: options.retractBetweenPasses ?? resolveRetractBetweenPasses(settings),
    passes,
  };
}
