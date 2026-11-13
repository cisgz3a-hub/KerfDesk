import type { DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncLayerSettings, CncMachineConfig, CncTool, Layer } from '../scene';
import { coolantFields } from './coolant-fields';
import { resolveRetractBetweenPasses, type CncGroupCompileOptions } from './compile-cnc-helpers';
import { cncCuttingRates } from './cnc-cutting-rates';
import { cncGroupProvenance } from './cnc-group-provenance';
import { withPassAirFloors } from './cnc-pass-air-floors';
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
  // A drill cycle is all vertical moves, which run at the plunge feed, so its
  // group names that feed: the lower of the two named a feed never sent
  // whenever plunge was faster (CNC audit v1 F4-P3-2).
  const cutFeed = settings.cutType === 'drill' ? settings.plungeMmPerMin : settings.feedMmPerMin;
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType: settings.cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    ...cncGroupProvenance(settings, tool, options),
    // ADR-233 Amd 1: a capped spindle scales the feeds so the chip load holds.
    ...cncCuttingRates(
      {
        feedMmPerMin: cutFeed,
        plungeMmPerMin: settings.plungeMmPerMin,
        spindleRpm: settings.spindleRpm,
      },
      device.maxFeed,
      config.params.spindleMaxRpm,
    ),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    retractBetweenPasses: options.retractBetweenPasses ?? resolveRetractBetweenPasses(settings),
    passes: withPassAirFloors(passes),
  };
}
