import type { DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncLayerSettings, CncMachineConfig, CncTool, Layer } from '../scene';
import type { CncCuttingStage } from '../scene/cnc-stage-recipe';
import { coolantFields } from './coolant-fields';
import { cncGroupProvenance } from './cnc-group-provenance';
import { parkFields } from './motion-polish';
import { cncStageProvenance } from './cnc-stage-settings';
const MIN_FEED_MM_PER_MIN = 1;
export function reliefGroup(
  layer: Layer,
  settings: CncLayerSettings,
  device: DeviceProfile,
  config: CncMachineConfig,
  tool: CncTool,
  cutType: 'relief-rough' | 'relief-finish' | 'engrave' | 'profile-on-path',
  stage: CncCuttingStage | undefined,
  passes: ReadonlyArray<CncPass>,
  layerPrimaryTool: CncTool = tool,
): CncGroup {
  return {
    kind: 'cnc',
    layerId: layer.id,
    color: layer.color,
    cutType,
    toolId: tool.id,
    toolName: tool.name,
    toolDiameterMm: tool.diameterMm,
    ...cncGroupProvenance(settings, tool, {
      includeRequestedDepth: false,
      includeDepthPerPass: cutType === 'relief-rough',
      includeVResolution: false,
      // Generic provenance must not claim the layer's requested ramp.
      // A relief stage that actually ramps sets its angle explicitly below;
      // finishing retains no entry claim (ADR-273 Amendment 1).
      includeRampEntry: false,
      layerPrimaryTool,
      ...(stage === undefined ? {} : cncStageProvenance(settings, stage, tool)),
    }),
    feedMmPerMin: cap(settings.feedMmPerMin, device.maxFeed),
    plungeMmPerMin: cap(settings.plungeMmPerMin, device.maxFeed),
    spindleRpm: Math.min(Math.max(0, settings.spindleRpm), config.params.spindleMaxRpm),
    spindleSpinupSec: Math.max(0, config.params.spindleSpinupSec),
    ...coolantFields(config),
    safeZMm: Math.max(0, config.params.safeZMm),
    ...parkFields(config),
    // Relief roughing/finishing follows the surface continuously; the emitter's
    // per-pass retract mode does not apply (ADR-253).
    retractBetweenPasses: false,
    // Roughing ramps into each level from the one above (ADR-424); recorded
    // as the group's requested entry. Actual ramps and retained short-loop
    // plunges carry separate markers; a lower start alone is not a tiled entry.
    ...(cutType === 'relief-rough' && settings.rampEntryDeg !== undefined
      ? { rampEntryDeg: settings.rampEntryDeg }
      : {}),
    passes,
  };
}

function cap(feedMmPerMin: number, maxFeed: number): number {
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) return MIN_FEED_MM_PER_MIN;
  return Math.min(feedMmPerMin, maxFeed);
}
