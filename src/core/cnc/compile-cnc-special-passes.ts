import type { CncPass } from '../job';
import type { CncStrategyFallback } from '../job/cnc-compilation-sidecar-types';
import type { CncLayerSettings, CncTool, Polyline } from '../scene';
import { compileAdaptivePocketForSettings } from './adaptive-pocket-operation';
import { zPassDepths } from './depth-passes';
import { drillPeckPasses } from './drill-peck';
import { vcarveMedialPasses } from './vcarve-medial';
import { vcarveMedialOptionsForLayer } from './vcarve-medial-options';
import type { FrameHandedness } from './machine-frame-handedness';

/** `passes` is null for the ordinary XY-toolpath × depth grid. An adaptive
 * layer the planner or verifier refused cuts that grid too, and says why. */
export type SpecializedLayerPasses = {
  readonly passes: ReadonlyArray<CncPass> | null;
  readonly strategyFallback?: Omit<CncStrategyFallback, 'layerId'>;
};

// Cut types whose pass geometry is not the ordinary XY-toolpath × depth grid.
export function specializedPassesForLayer(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  tool: CncTool,
  handedness: FrameHandedness,
): SpecializedLayerPasses {
  if (settings.cutType === 'v-carve') {
    return {
      passes: vcarveMedialPasses(polylines, vcarveMedialOptionsForLayer(settings, tool)).passes,
    };
  }
  if (settings.cutType === 'drill') {
    return {
      passes: drillPeckPasses(polylines, {
        depthMm: settings.depthMm,
        depthPerPassMm: settings.depthPerPassMm,
      }),
    };
  }
  const adaptive = compileAdaptivePocketForSettings(
    polylines,
    settings,
    tool,
    zPassDepths(settings.depthMm, settings.depthPerPassMm),
    handedness,
  );
  if (adaptive.kind === 'passes') return { passes: adaptive.passes };
  return adaptive.kind === 'offset-fallback'
    ? { passes: null, strategyFallback: { kind: 'adaptive-offset', reason: adaptive.reason } }
    : { passes: null };
}
