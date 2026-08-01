// findCncOffsetLadderFailures — output layers whose inward-offset ladder was
// cut short by an offset-ENGINE failure or a fixed pass budget rather than by
// the region running out of interior.
//
// findDroppedCncLayers (compile-cnc-diagnostics.ts) catches the all-or-nothing
// case: a layer with geometry that yields no toolpath at all. This catches the
// PARTIAL case, which is the dangerous one on a router — a pocket that stops a
// few rings early looks finished, and a later pass meets stock it believed was
// cleared. Advisory input only: the caller renders a Job Review warning, and
// nothing here refuses Frame, Start or a save (rule 7).
//
// Like findDroppedCncLayers this re-runs compile geometry from the scene
// rather than threading a flag through a dozen toolpath signatures. The CNC
// warning path already compiles the whole job twice (cnc-stock-warnings.ts,
// cnc-full-tab-coverage-warnings.ts), so re-running the ladders is in line
// with what that path already pays — and it leaves the compile hot path, and
// therefore every byte of emitted G-code, untouched.
//
// Covered: pocket (ring and raster, with the layer's bit and any rest-machining
// roughing bit), v-carve (the ring ladder plus the two-stage clearing pocket)
// and relief roughing. Adaptive pocketing uses a different engine with no
// offset ladder. Inlay pairs are NOT covered — their female pocket needs the
// full linked plan to reproduce.

import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
  type Polyline,
  type Scene,
} from '../scene';
import { collectLayerPolylines } from './collect-cnc-contours';
import { resolveRestPocketOperation } from './cnc-rest-operation';
import { reliefOffsetLadderFailed } from './compile-cnc-relief';
import { pocketRasterToolpaths, pocketRingToolpaths } from './pocket-paths';
import { vcarveClearancePocket } from './vcarve-clearance';
import { vcarveLadderPasses } from './vcarve-ladder';

export function findCncOffsetLadderFailures(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<string> {
  return findCncOffsetLadderDiagnostics(scene, device, config)
    .filter((diagnostic) => diagnostic.kind === 'geometry-failed')
    .map((diagnostic) => diagnostic.layerId);
}

export type CncOffsetLadderDiagnostic = {
  readonly layerId: string;
  readonly kind: 'geometry-failed' | 'pass-limit';
};

// Keeps the end reason available to the advisory UI. Existing callers that
// only understand engine failures retain findCncOffsetLadderFailures above.
// Neither helper participates in compile, Frame, Start, or Save authorization.
export function findCncOffsetLadderDiagnostics(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
): ReadonlyArray<CncOffsetLadderDiagnostic> {
  const diagnostics: CncOffsetLadderDiagnostic[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const polylines = collectLayerPolylines(scene.objects, layer, device);
    const restCompletion =
      polylines.length === 0 ? 'complete' : restPocketCompletion(polylines, settings, config);
    if (restCompletion !== 'complete') {
      diagnostics.push({ layerId: layer.id, kind: restCompletion });
      continue;
    }
    const vectorFailed = polylines.length > 0 && vectorLadderFailed(polylines, settings, config);
    // A layer can carry both relief objects and vector shapes; either ladder
    // failing makes the layer's output incomplete.
    if (vectorFailed || reliefOffsetLadderFailed(scene.objects, layer, settings, config)) {
      diagnostics.push({ layerId: layer.id, kind: 'geometry-failed' });
    }
  }
  return diagnostics;
}

function vectorLadderFailed(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): boolean {
  const tool = layerCncTool(config, settings);
  if (settings.cutType === 'pocket') return pocketLadderFailed(polylines, settings, config, tool);
  if (settings.cutType === 'v-carve') return vcarveLadderFailed(polylines, settings, config, tool);
  // Profile, engrave, drill and inlay reach the emitter without walking an
  // offset ladder. Deliberately not an exhaustive match — a diagnostic should
  // report nothing for a cut type it does not know, not fail to compile.
  return false;
}

function pocketLadderFailed(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
): boolean {
  // Rest machining roughs with a second, larger bit through the same pocket
  // engine, and its ladder can fail where the finishing bit's does not. It also
  // runs a THIRD ladder of its own over the leftover stock region
  // (rest-pocket.ts), on raw clipper paths rather than the kerf-offset wrapper.
  if (restPocketCompletion(polylines, settings, config) === 'geometry-failed') return true;
  const roughTool = toolById(config, settings.pocketRoughToolId);
  const diameters = [tool.diameterMm, ...(roughTool === null ? [] : [roughTool.diameterMm])];
  return diameters.some((diameterMm) => pocketStrategyFailed(polylines, settings, diameterMm));
}

function restPocketCompletion(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): 'complete' | 'geometry-failed' | 'pass-limit' {
  const rest = resolveRestPocketOperation(polylines, settings, config);
  return rest.kind === 'ok' ? rest.completion : 'complete';
}

function pocketStrategyFailed(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  toolDiameterMm: number,
): boolean {
  if (settings.pocketStrategy === 'adaptive') return false;
  if (settings.pocketStrategy === 'raster-x' || settings.pocketStrategy === 'raster-y') {
    return pocketRasterToolpaths(
      polylines,
      toolDiameterMm,
      settings.stepoverPercent,
      settings.pocketStrategy === 'raster-x' ? 'x' : 'y',
    ).offsetFailed;
  }
  return pocketRingToolpaths(polylines, toolDiameterMm, settings.stepoverPercent).offsetFailed;
}

function vcarveLadderFailed(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
): boolean {
  const ladder = vcarveLadderPasses(polylines, {
    tool,
    maxDepthMm: settings.depthMm,
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
    ...(settings.vCarveRampEntryDeg === undefined
      ? {}
      : { rampAngleDeg: settings.vCarveRampEntryDeg }),
  });
  if (ladder.offsetFailed) return true;
  const clearTool = toolById(config, settings.vClearToolId);
  if (clearTool === null) return false;
  return vcarveClearancePocket(polylines, {
    vBit: tool,
    clearTool,
    maxDepthMm: settings.depthMm,
    stepoverPercent: settings.stepoverPercent,
  }).offsetFailed;
}

function toolById(config: CncMachineConfig, toolId: string | undefined): CncTool | null {
  if (toolId === undefined) return null;
  return config.tools.find((tool) => tool.id === toolId) ?? null;
}
