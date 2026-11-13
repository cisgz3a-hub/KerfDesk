import type { DeviceProfile } from '../devices';
import type { CncGroup, CncPass } from '../job';
import type { CncLayerSettings, CncMachineConfig, CncTool, Layer } from '../scene';
import type { CncCuttingStage } from '../scene/cnc-stage-recipe';
import { coolantFields } from './coolant-fields';
import { cncCuttingRates } from './cnc-cutting-rates';
import { cncGroupProvenance } from './cnc-group-provenance';
import { parkFields } from './motion-polish';
import { cncStageProvenance } from './cnc-stage-settings';
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
      // Roughing levels and a projection's step-down ladder (rolling audit v11
      // W6-P2-1) honour Depth per pass; finishing rides the surface in one.
      includeDepthPerPass: cutType !== 'relief-finish',
      includeVResolution: false,
      // Generic provenance must not claim the layer's requested ramp.
      // A relief stage that actually ramps sets its angle explicitly below;
      // finishing retains no entry claim (ADR-273 Amendment 1).
      includeRampEntry: false,
      layerPrimaryTool,
      ...(stage === undefined ? {} : cncStageProvenance(settings, stage, tool)),
    }),
    // ADR-233 Amd 1: a capped spindle scales the feeds so the chip load holds.
    ...cncCuttingRates(settings, device.maxFeed, config.params.spindleMaxRpm),
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
