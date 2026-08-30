import type { CncPass } from '../job';
import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import { adaptivePocketPassesForSettings } from './adaptive-pocket-operation';
import { zPassDepths } from './depth-passes';
import { drillPeckPasses } from './drill-peck';
import { vcarveMedialPasses } from './vcarve-medial';
import { vcarveMedialOptionsForLayer } from './vcarve-medial-options';
import type { FrameHandedness } from './machine-frame-handedness';

// Cut types whose pass geometry is not the ordinary XY-toolpath × depth grid.
export function specializedPassesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  handedness: FrameHandedness,
): ReadonlyArray<CncPass> | null {
  if (settings.cutType === 'v-carve') {
    return vcarveMedialPasses(polylines, vcarveMedialOptionsForLayer(settings, tool)).passes;
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
    handedness,
  );
}
