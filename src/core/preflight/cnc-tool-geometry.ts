import { collectLayerPolylines } from '../cnc/collect-cnc-contours';
import { vcarveResolutionMm } from '../cnc/vcarve-ladder';
import { zPassDepths } from '../cnc/depth-passes';
import type { DeviceProfile } from '../devices';
import { insetContoursChecked } from '../geometry/offset-ladder';
import {
  DEFAULT_CNC_LAYER_SETTINGS,
  MIN_CNC_TIP_ANGLE_DEG,
  isValidCncTipAngleDeg,
  layerCncTool,
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
    if (settings.cutType !== 'v-carve') continue;
    const contours = contributingContours(scene, layer, device);
    if (contours.length === 0) continue;
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
