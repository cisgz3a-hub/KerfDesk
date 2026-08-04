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
// roughing bit), V-carve (the certified medial planner plus any flat-core or
// two-stage clearing pocket), and relief roughing. Adaptive pocketing uses a
// offset ladder. Inlay pairs are NOT covered — their female pocket needs the
// full linked plan to reproduce.

import type { DeviceProfile } from '../devices';
import type { Job } from '../job';
import type { CncVCarveCompilationEvidence } from '../job/job';
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
import { vcarveEffectiveDepthMm } from './vcarve-depth';
import { vcarveMedialPasses } from './vcarve-medial';

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
  readonly kind: 'geometry-failed' | 'pass-limit' | 'thin-detail-dropped';
};

// Keeps the end reason available to the advisory UI. Existing callers that
// only understand engine failures retain findCncOffsetLadderFailures above.
// Neither helper participates in compile, Frame, Start, or Save authorization.
export function findCncOffsetLadderDiagnostics(
  scene: Scene,
  device: DeviceProfile,
  config: CncMachineConfig,
  compiledJob?: Job,
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
    const vectorKinds =
      polylines.length > 0
        ? vectorLadderDiagnosticKinds(
            polylines,
            settings,
            config,
            compiledVCarveEvidence(compiledJob, layer.id),
          )
        : [];
    // A layer can carry both relief objects and vector shapes; either ladder
    // failing makes the layer's output incomplete.
    if (
      vectorKinds.includes('geometry-failed') ||
      reliefOffsetLadderFailed(scene.objects, layer, settings, config)
    ) {
      diagnostics.push({ layerId: layer.id, kind: 'geometry-failed' });
    }
    if (vectorKinds.includes('thin-detail-dropped')) {
      diagnostics.push({ layerId: layer.id, kind: 'thin-detail-dropped' });
    }
    if (vectorKinds.includes('pass-limit')) {
      diagnostics.push({ layerId: layer.id, kind: 'pass-limit' });
    }
  }
  return diagnostics;
}

function vectorLadderDiagnosticKinds(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  vcarveEvidence?: ReadonlyArray<CncVCarveCompilationEvidence> | null,
): ReadonlyArray<CncOffsetLadderDiagnostic['kind']> {
  const tool = layerCncTool(config, settings);
  if (settings.cutType === 'pocket') {
    return pocketLadderFailed(polylines, settings, config, tool) ? ['geometry-failed'] : [];
  }
  if (settings.cutType === 'v-carve') {
    // A compiled job with no matching sidecar evidence is a legacy exact
    // artifact. Omit this advisory rather than planning on the browser thread.
    if (vcarveEvidence === null) return [];
    if (vcarveEvidence !== undefined) {
      return compiledVCarveDiagnosticKinds(polylines, settings, config, tool, vcarveEvidence);
    }
    return vcarveDiagnosticKinds(polylines, settings, config, tool);
  }
  // Profile, engrave, drill and inlay reach the emitter without walking an
  // offset ladder. Deliberately not an exhaustive match — a diagnostic should
  // report nothing for a cut type it does not know, not fail to compile.
  return [];
}

function compiledVCarveEvidence(
  job: Job | undefined,
  layerId: string,
): ReadonlyArray<CncVCarveCompilationEvidence> | null | undefined {
  if (job === undefined) return undefined;
  const sidecar = job.cncCompilation;
  if (sidecar === undefined) return null;
  const evidence = sidecar.vcarveOperations.filter((entry) => entry.layerId === layerId);
  return evidence.length === 0 ? null : evidence;
}

function compiledVCarveDiagnosticKinds(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
  evidence: ReadonlyArray<CncVCarveCompilationEvidence>,
): ReadonlyArray<CncOffsetLadderDiagnostic['kind']> {
  const kinds: Array<CncOffsetLadderDiagnostic['kind']> = [];
  if (
    evidence.some((entry) => entry.offsetFailed) ||
    vcarveClearanceFailed(polylines, settings, config, tool)
  ) {
    kinds.push('geometry-failed');
  }
  if (evidence.some((entry) => entry.thinResidual)) kinds.push('thin-detail-dropped');
  if (evidence.some((entry) => entry.passLimited)) kinds.push('pass-limit');
  return kinds;
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

function vcarveDiagnosticKinds(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
): ReadonlyArray<CncOffsetLadderDiagnostic['kind']> {
  const plan = vcarveMedialPasses(polylines, {
    tool,
    maxDepthMm:
      (settings.vCarveFlatDepthEnabled ?? true) ? settings.depthMm : Number.POSITIVE_INFINITY,
    depthPerPassMm: settings.depthPerPassMm,
    resolutionMm: settings.vResolutionMm,
    ...(settings.vCarveRampEntryDeg === undefined
      ? {}
      : { rampAngleDeg: settings.vCarveRampEntryDeg }),
  });
  const kinds: Array<CncOffsetLadderDiagnostic['kind']> = [];
  if (plan.offsetFailed || vcarveClearanceFailed(polylines, settings, config, tool)) {
    kinds.push('geometry-failed');
  }
  // Artwork finer than certified medial sampling can represent stays uncut;
  // that is a Job Review advisory, never a refusal under the frame-only rule.
  if (plan.thinResidual) kinds.push('thin-detail-dropped');
  // A medial sample budget or flat-core route budget can leave detail
  // unresolved; it remains advisory-only under the same rule.
  if (plan.passLimited) kinds.push('pass-limit');
  return kinds;
}

function vcarveClearanceFailed(
  polylines: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
  tool: CncTool,
): boolean {
  if (!(settings.vCarveFlatDepthEnabled ?? true)) return false;
  const clearTool = toolById(config, settings.vClearToolId);
  if (clearTool === null) return false;
  const effectiveDepthMm = vcarveEffectiveDepthMm(tool, settings.depthMm);
  if (effectiveDepthMm === null) return false;
  return vcarveClearancePocket(polylines, {
    vBit: tool,
    clearTool,
    maxDepthMm: effectiveDepthMm,
    stepoverPercent: settings.stepoverPercent,
  }).offsetFailed;
}

function toolById(config: CncMachineConfig, toolId: string | undefined): CncTool | null {
  if (toolId === undefined) return null;
  return config.tools.find((tool) => tool.id === toolId) ?? null;
}
