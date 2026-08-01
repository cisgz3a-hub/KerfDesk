import type { CncGroup } from '../job';
import type { CncLayerSettings, CncTool } from '../scene';

type CncGroupProvenance = Pick<
  CncGroup,
  | 'toolKind'
  | 'toolTipAngleDeg'
  | 'toolFluteCount'
  | 'layerPrimaryToolId'
  | 'requestedDepthMm'
  | 'depthPerPassMm'
  | 'vResolutionMm'
  | 'rampEntryDeg'
  | 'feedSource'
>;

type CncGroupProvenanceOptions = {
  readonly includeRequestedDepth?: boolean;
  readonly includeDepthPerPass?: boolean;
  readonly includeVResolution?: boolean;
  readonly includeRampEntry?: boolean;
  readonly layerPrimaryTool?: CncTool;
};

/** Copy the operator-facing settings that explain how a CNC group was built. */
export function cncGroupProvenance(
  settings: CncLayerSettings,
  tool: CncTool,
  options: CncGroupProvenanceOptions = {},
): CncGroupProvenance {
  return {
    ...toolProvenance(tool, options.layerPrimaryTool ?? tool),
    ...depthProvenance(settings, options),
    ...entryAndFeedProvenance(settings, options),
  };
}

function toolProvenance(tool: CncTool, layerPrimaryTool: CncTool): CncGroupProvenance {
  return {
    toolKind: tool.kind,
    ...(tool.tipAngleDeg === undefined ? {} : { toolTipAngleDeg: tool.tipAngleDeg }),
    ...(tool.fluteCount === undefined ? {} : { toolFluteCount: tool.fluteCount }),
    layerPrimaryToolId: layerPrimaryTool.id,
  };
}

function depthProvenance(
  settings: CncLayerSettings,
  options: CncGroupProvenanceOptions,
): CncGroupProvenance {
  const includeRequestedDepth = options.includeRequestedDepth ?? true;
  const includeDepthPerPass = options.includeDepthPerPass ?? true;
  const includeVResolution = options.includeVResolution ?? settings.cutType === 'v-carve';
  return {
    ...(includeRequestedDepth ? { requestedDepthMm: settings.depthMm } : {}),
    ...(includeDepthPerPass ? { depthPerPassMm: settings.depthPerPassMm } : {}),
    ...(includeVResolution ? { vResolutionMm: settings.vResolutionMm } : {}),
  };
}

function entryAndFeedProvenance(
  settings: CncLayerSettings,
  options: CncGroupProvenanceOptions,
): CncGroupProvenance {
  const includeRampEntry = options.includeRampEntry ?? true;
  const rampEntryDeg =
    settings.cutType === 'v-carve' ? settings.vCarveRampEntryDeg : settings.rampEntryDeg;
  return {
    ...(includeRampEntry && rampEntryDeg !== undefined ? { rampEntryDeg } : {}),
    ...(settings.feedSource === undefined ? {} : { feedSource: settings.feedSource }),
  };
}
