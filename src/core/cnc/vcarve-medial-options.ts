import type { CncLayerSettings, CncTool } from '../scene';
import type { VCarveOptions } from './vcarve-ladder';

/** The one mapping from persisted layer settings to medial-planner inputs. */
export function vcarveMedialOptionsForLayer(
  settings: CncLayerSettings,
  tool: CncTool,
): VCarveOptions {
  return {
    tool,
    // Missing means a pre-medial saved project whose reviewed flat-depth bytes
    // must remain unchanged. Newly created layers persist the explicit mode.
    maxDepthMm:
      (settings.vCarveFlatDepthEnabled ?? true) ? settings.depthMm : Number.POSITIVE_INFINITY,
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
    ...(settings.vCarveRampEntryDeg === undefined
      ? {}
      : { rampAngleDeg: settings.vCarveRampEntryDeg }),
  };
}
