import type { CncGroup } from '../job';
import type { CncLayerSettings, CncTool } from '../scene';

type CncGroupProvenance = Pick<
  CncGroup,
  | 'toolKind'
  | 'toolTipAngleDeg'
  | 'requestedDepthMm'
  | 'depthPerPassMm'
  | 'vResolutionMm'
  | 'feedSource'
>;

type CncGroupProvenanceOptions = {
  readonly includeRequestedDepth?: boolean;
  readonly includeVResolution?: boolean;
};

/** Copy the operator-facing settings that explain how a CNC group was built. */
export function cncGroupProvenance(
  settings: CncLayerSettings,
  tool: CncTool,
  options: CncGroupProvenanceOptions = {},
): CncGroupProvenance {
  const includeRequestedDepth = options.includeRequestedDepth ?? true;
  const includeVResolution = options.includeVResolution ?? settings.cutType === 'v-carve';
  return {
    toolKind: tool.kind,
    ...(tool.tipAngleDeg === undefined ? {} : { toolTipAngleDeg: tool.tipAngleDeg }),
    ...(includeRequestedDepth ? { requestedDepthMm: settings.depthMm } : {}),
    depthPerPassMm: settings.depthPerPassMm,
    ...(includeVResolution ? { vResolutionMm: settings.vResolutionMm } : {}),
    ...(settings.feedSource === undefined ? {} : { feedSource: settings.feedSource }),
  };
}
