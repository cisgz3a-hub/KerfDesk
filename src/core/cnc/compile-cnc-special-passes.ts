import type { CncPass } from '../job';
import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import { adaptivePocketPassesForSettings } from './adaptive-pocket-operation';
import { zPassDepths } from './depth-passes';
import { drillPeckPasses } from './drill-peck';
import { vcarveMedialPasses } from './vcarve-medial';

// Cut types whose pass geometry is not the ordinary XY-toolpath × depth grid.
export function specializedPassesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType === 'v-carve') {
    const options = {
      tool,
      // A missing flag belongs to a pre-medial saved project and retains its
      // reviewed flat-depth bytes. New layers persist false and use the full
      // modeled V-bit cone for an ordinary flowing-depth carve.
      maxDepthMm:
        (settings.vCarveFlatDepthEnabled ?? true) ? settings.depthMm : Number.POSITIVE_INFINITY,
      depthPerPassMm: settings.depthPerPassMm,
      resolutionMm: settings.vResolutionMm,
      ...(settings.vCarveRampEntryDeg === undefined
        ? {}
        : { rampAngleDeg: settings.vCarveRampEntryDeg }),
    };
    return vcarveMedialPasses(polylines, options).passes;
  }
  if (settings.cutType === 'drill') {
    return drillPeckPasses(polylines, {
      depthMm: settings.depthMm,
      depthPerPassMm: settings.depthPerPassMm,
    });
  }
  return adaptivePocketPassesForSettings(
    polylines,
    settings,
    tool,
    zPassDepths(settings.depthMm, settings.depthPerPassMm),
  );
}
