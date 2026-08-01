import type { CncGroup } from '../job';
import type { CncLayerSettings, CncTool } from '../scene';

type CncGroupProvenance = Pick<
  CncGroup,
  | 'toolKind'
  | 'toolTipAngleDeg'
  | 'requestedDepthMm'
  | 'depthPerPassMm'
  | 'vResolutionMm'
  | 'rampEntryDeg'
  | 'feedSource'
>;

type CncGroupProvenanceOptions = {
  readonly includeRequestedDepth?: boolean;
  readonly includeVResolution?: boolean;
  readonly includeRampEntry?: boolean;
};

/** Copy the operator-facing settings that explain how a CNC group was built. */
export function cncGroupProvenance(
  settings: CncLayerSettings,
  tool: CncTool,
  options: CncGroupProvenanceOptions = {},
): CncGroupProvenance {
  const includeRequestedDepth = options.includeRequestedDepth ?? true;
  const includeVResolution = options.includeVResolution ?? settings.cutType === 'v-carve';
  const includeRampEntry = options.includeRampEntry ?? true;
  const rampEntryDeg =
    settings.cutType === 'v-carve' ? settings.vCarveRampEntryDeg : settings.rampEntryDeg;
  return {
    toolKind: tool.kind,
    ...(tool.tipAngleDeg === undefined ? {} : { toolTipAngleDeg: tool.tipAngleDeg }),
    ...(includeRequestedDepth ? { requestedDepthMm: settings.depthMm } : {}),
    depthPerPassMm: settings.depthPerPassMm,
    ...(includeVResolution ? { vResolutionMm: settings.vResolutionMm } : {}),
    ...(includeRampEntry && rampEntryDeg !== undefined ? { rampEntryDeg } : {}),
    ...(settings.feedSource === undefined ? {} : { feedSource: settings.feedSource }),
  };
}
