import {
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
} from '../scene';
import { pocketToolpathRaster, pocketToolpathRings } from './pocket-paths';
import { planRestPocketToolpaths } from './rest-pocket';

export type CncRestPocketOperation =
  | { readonly kind: 'not-requested' }
  | { readonly kind: 'error'; readonly reason: string }
  | {
      readonly kind: 'ok';
      readonly roughTool: CncTool;
      readonly finishTool: CncTool;
      readonly roughToolpaths: ReadonlyArray<Polyline>;
      readonly restToolpaths: ReadonlyArray<Polyline>;
    };

export function resolveRestPocketOperation(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): CncRestPocketOperation {
  if (settings.cutType !== 'pocket' || settings.pocketRoughToolId === undefined) {
    return { kind: 'not-requested' };
  }
  if (settings.helixEntry !== undefined) {
    return { kind: 'error', reason: 'Rest machining and helical entry cannot be combined yet.' };
  }
  const roughTool = config.tools.find((tool) => tool.id === settings.pocketRoughToolId);
  if (roughTool === undefined) {
    return { kind: 'error', reason: 'The selected pocket roughing bit is missing.' };
  }
  const finishTool = layerCncTool(config, settings);
  const rest = planRestPocketToolpaths(
    contours,
    roughTool.diameterMm,
    finishTool.diameterMm,
    settings.stepoverPercent,
  );
  if (!rest.ok) return { kind: 'error', reason: rest.reason };
  const roughToolpaths = pocketToolpathsForSettings(contours, settings, roughTool.diameterMm);
  if (roughToolpaths.length === 0) {
    return { kind: 'error', reason: 'The roughing bit does not fit this pocket.' };
  }
  return {
    kind: 'ok',
    roughTool,
    finishTool,
    roughToolpaths,
    restToolpaths: rest.toolpaths,
  };
}

export function pocketToolpathsForSettings(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): ReadonlyArray<Polyline> {
  if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') {
    return pocketToolpathRaster(
      polylines,
      toolDiameterMm,
      settings.stepoverPercent,
      settings.pocketStrategy === 'raster-x' ? 'x' : 'y',
    );
  }
  return pocketToolpathRings(polylines, toolDiameterMm, settings.stepoverPercent);
}
