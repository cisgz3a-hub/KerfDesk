import { collectLayerPolylines } from '../cnc/collect-cnc-contours';
import { vcarveClearanceToolpaths, vcarveHasFlatFloor } from '../cnc/vcarve-clearance';
import { zPassCount } from '../cnc/depth-passes';
import { isValidCncTipAngleDeg } from '../cnc-tip-angle';
import type { DeviceProfile } from '../devices';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncMachineConfig,
  type Layer,
  type Polyline,
  type Scene,
} from '../scene';
import type { PreflightIssue } from './preflight';

/**
 * Finds legacy or hand-edited V-bit definitions that cannot support V-carve
 * depth math without inventing an angle. New tools are validated at entry,
 * while this remains the compile-integrity boundary for existing projects.
 */
export function findInvalidCncToolGeometry(
  scene: Scene,
  config: CncMachineConfig,
  device: DeviceProfile,
): ReadonlyArray<PreflightIssue> {
  const issues: PreflightIssue[] = [];
  for (const layer of scene.layers) {
    if (!layer.output) continue;
    const settings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
    const invalidReliefFinishTool = invalidReliefFinishToolIssue(scene, layer, settings, config);
    if (invalidReliefFinishTool !== null) issues.push(invalidReliefFinishTool);
    const contours = contributingContours(scene, layer, device);
    if (contours.length === 0) continue;
    const invalidRestRoughTool = invalidRestRoughToolIssue(layer, settings, config);
    if (invalidRestRoughTool !== null) issues.push(invalidRestRoughTool);
    if (settings.cutType !== 'v-carve') continue;
    const invalidClearTool = invalidVCarveClearToolIssue(layer, settings, contours, config);
    if (invalidClearTool !== null) issues.push(invalidClearTool);
    const tool = layerCncTool(config, settings);
    if (tool.kind !== 'v-bit' || isValidCncTipAngleDeg(tool.tipAngleDeg)) continue;
    if (!invalidAngleCanChangeOutput(settings)) continue;
    issues.push({
      code: 'cnc-tool-geometry-invalid',
      message:
        `Layer ${layer.id}: V-carve requires an explicit included angle from 1 to 179 degrees ` +
        `for "${tool.name}". Edit or replace this bit before generating toolpaths.`,
    });
  }
  return issues;
}

function invalidRestRoughToolIssue(
  layer: Layer,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): PreflightIssue | null {
  if (
    settings.cutType !== 'pocket' ||
    settings.pocketRestStock !== undefined ||
    settings.pocketRoughToolId === undefined ||
    settings.pocketStrategy === 'adaptive' ||
    settings.helixEntry !== undefined
  ) {
    return null;
  }
  const roughTool = config.tools.find((candidate) => candidate.id === settings.pocketRoughToolId);
  if (roughTool?.kind === 'end-mill') return null;
  const detail =
    roughTool === undefined
      ? `selected bit "${settings.pocketRoughToolId}" is missing`
      : `"${roughTool.name}" is ${roughTool.kind}`;
  return {
    code: 'cnc-tool-geometry-invalid',
    message:
      `Layer ${layer.id}: pocket roughing requires a flat end mill; ${detail}. ` +
      'Choose an end mill or disable Rough first before generating toolpaths.',
  };
}

function invalidReliefFinishToolIssue(
  scene: Scene,
  layer: Layer,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): PreflightIssue | null {
  if (settings.reliefFinishToolId === undefined) return null;
  if (config.tools.some((candidate) => candidate.id === settings.reliefFinishToolId)) return null;
  const hasRelief = scene.objects.some(
    (object) => object.kind === 'relief' && sceneObjectUsesOperation(object, layer),
  );
  if (!hasRelief) return null;
  return {
    code: 'cnc-tool-geometry-invalid',
    message:
      `Layer ${layer.id}: selected relief finishing bit "${settings.reliefFinishToolId}" is missing. ` +
      'Choose a finishing bit or disable finishing before generating toolpaths.',
  };
}

function invalidVCarveClearToolIssue(
  layer: Layer,
  settings: CncLayerSettings,
  contours: ReadonlyArray<Polyline>,
  config: CncMachineConfig,
): PreflightIssue | null {
  if (!(settings.vCarveFlatDepthEnabled ?? true) || settings.vClearToolId === undefined) {
    return null;
  }
  const clearTool = config.tools.find((candidate) => candidate.id === settings.vClearToolId);
  if (clearTool === undefined) {
    if (zPassCount(settings.depthMm, settings.depthPerPassMm) === 0) return null;
    if (
      !vcarveHasFlatFloor(contours, {
        vBit: layerCncTool(config, settings),
        maxDepthMm: settings.depthMm,
      })
    ) {
      return null;
    }
    return {
      code: 'cnc-tool-geometry-invalid',
      message:
        `Layer ${layer.id}: selected V-carve clearing bit "${settings.vClearToolId}" is missing. ` +
        'Choose a flat end mill or disable floor clearing before generating toolpaths.',
    };
  }
  if (clearTool.kind === 'end-mill') return null;
  if (zPassCount(settings.depthMm, settings.depthPerPassMm) === 0) return null;
  const vBit = layerCncTool(config, settings);
  const clearancePaths = vcarveClearanceToolpaths(contours, {
    vBit,
    clearTool,
    maxDepthMm: settings.depthMm,
    stepoverPercent: settings.stepoverPercent,
  });
  if (clearancePaths.length === 0) return null;
  return {
    code: 'cnc-tool-geometry-invalid',
    message:
      `Layer ${layer.id}: V-carve flat-floor clearing requires a flat end mill; ` +
      `"${clearTool.name}" is ${clearTool.kind}. Choose an end mill before generating toolpaths.`,
  };
}

function contributingContours(
  scene: Scene,
  layer: Layer,
  device: DeviceProfile,
): ReadonlyArray<Polyline> {
  return collectLayerPolylines(scene.objects, layer, device).filter(
    (polyline) =>
      polyline.closed &&
      polyline.points.length >= 3 &&
      polyline.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  );
}

// The medial planner (ADR-285) carves every closed contributing region, however
// narrow, so any positive requested depth needs the bit's real angle.
function invalidAngleCanChangeOutput(settings: CncLayerSettings): boolean {
  return settings.depthMm > 0;
}
