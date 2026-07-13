import type { CncPass } from '../job';
import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import { adaptivePocketPassesForSettings } from './adaptive-pocket-operation';
import { zPassDepths } from './depth-passes';
import { drillPeckPasses } from './drill-peck';
import { vcarvePasses } from './vcarve-ladder';

// Cut types whose pass geometry is not the ordinary XY-toolpath × depth grid.
export function specializedPassesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType === 'v-carve') {
    return vcarvePasses(polylines, {
      tool,
      maxDepthMm: settings.depthMm,
      depthPerPassMm: settings.depthPerPassMm,
      resolutionMm: settings.vResolutionMm,
    });
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
