import { collectLayerPolylines } from '../cnc/collect-cnc-contours';
import { vcarveClearanceToolpaths, vcarveHasFlatFloor } from '../cnc/vcarve-clearance';
import { vcarveResolutionMm } from '../cnc/vcarve-ladder';
import { zPassDepths } from '../cnc/depth-passes';
import { MIN_CNC_TIP_ANGLE_DEG, isValidCncTipAngleDeg } from '../cnc-tip-angle';
import type { DeviceProfile } from '../devices';
import { insetContoursChecked } from '../geometry/offset-ladder';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  layerCncTool,
  sceneObjectUsesOperation,
  type CncLayerSettings,
  type CncMachineConfig,
  type CncTool,
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
    if (!invalidAngleCanChangeOutput(contours, settings, tool, config)) continue;
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
  if (settings.vClearToolId === undefined) return null;
  const clearTool = config.tools.find((candidate) => candidate.id === settings.vClearToolId);
  if (clearTool === undefined) {
    if (zPassDepths(settings.depthMm, settings.depthPerPassMm).length === 0) return null;
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
  if (zPassDepths(settings.depthMm, settings.depthPerPassMm).length === 0) return null;
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

function invalidAngleCanChangeOutput(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  vBit: CncTool,
  config: CncMachineConfig,
): boolean {
  if (!(settings.depthMm > 0)) return false;
  const firstInsetMm = vcarveResolutionMm(settings.vResolutionMm, vBit.diameterMm);
  if (
    Number.isFinite(firstInsetMm) &&
    firstInsetMm > 0 &&
    insetContoursChecked(contours, firstInsetMm).contours.length > 0
  ) {
    return true;
  }
  return twoStageClearanceCouldEmit(contours, settings, config);
}

function twoStageClearanceCouldEmit(
  contours: ReadonlyArray<Polyline>,
  settings: CncLayerSettings,
  config: CncMachineConfig,
): boolean {
  if (zPassDepths(settings.depthMm, settings.depthPerPassMm).length === 0) return false;
  const clearTool = config.tools.find((candidate) => candidate.id === settings.vClearToolId);
  if (clearTool === undefined || !(clearTool.diameterMm > 0)) return false;
  // At the minimum allowed angle the flat-floor clamp inset is smallest. If
  // even that case cannot produce a clearing pocket, no allowed angle can.
  // A contour-parallel pocket emits iff its first tool-radius inset exists,
  // so two single offsets prove existence without building the full ladder.
  const clampInsetMm = settings.depthMm * Math.tan((MIN_CNC_TIP_ANGLE_DEG * Math.PI) / 360);
  const floor = insetContoursChecked(contours, clampInsetMm);
  if (floor.contours.length === 0) return false;
  return insetContoursChecked(floor.contours, clearTool.diameterMm / 2).contours.length > 0;
}
