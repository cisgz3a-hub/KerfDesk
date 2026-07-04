// runCncPreflight — pre-write checks for CNC (router) jobs. The CNC analog of
// runPreflight: an empty issue list means safe-to-write. Pure: no I/O.
//
// Checks:
//   1. At least one output layer exists.
//   2. Per-layer CNC settings are sane: depth > 0, depth/pass > 0, feeds in
//      (0, device.maxFeed], spindle RPM in (0, spindleMaxRpm].
//   3. Cut depth does not exceed stock thickness by more than the through-cut
//      allowance (cutting into the spoilboard beyond that is a setup error).
//   4. All motion fits inside the bed (shared bounds scanner).
//   5. No-go zones are respected (shared scanner — clamps matter on a router).
//   6. Z is up on every XY rapid; no rapid plunges (findPlungedTravelIssues).
//   7. Generated G-code is non-empty (at least one G1 line).
//   8. No emitted Z below -(stock + through-cut allowance) — proves the depth
//      invariant on the final text, not just the settings (findOverdeepCutIssues).

import { machineBoundsForDevice } from '../devices';
import {
  DEFAULT_THROUGH_CUT_ALLOWANCE_MM,
  findOutOfBoundsCoords,
  findOverdeepCutIssues,
  findPlungedTravelIssues,
  type MotionBoundsOffset,
} from '../invariants';
import type { CncMachineConfig, Layer, Project } from '../scene';
import { DEFAULT_CNC_LAYER_SETTINGS, layerCncTool, type CncLayerSettings } from '../scene';
import { findNoGoZoneCollisions } from './no-go-zones';
import type { PreflightIssue, PreflightResult } from './preflight';

export type CncPreflightOptions = {
  readonly motionOffset?: MotionBoundsOffset | undefined;
};

const MAX_REPORTED_ISSUES = 5;
// Through-cuts intentionally run slightly past the stock bottom so the last
// pass fully severs; more than this is a mis-set depth or stock thickness.
// Shared with the emitted-text depth invariant (cnc-depth.ts) so the settings
// check and the G-code check can never disagree.
const THROUGH_CUT_ALLOWANCE_MM = DEFAULT_THROUGH_CUT_ALLOWANCE_MM;

export function runCncPreflight(
  project: Project,
  config: CncMachineConfig,
  gcode: string,
  options: CncPreflightOptions = {},
): PreflightResult {
  const issues: PreflightIssue[] = [];
  const outputLayers = project.scene.layers.filter((layer) => layer.output);

  if (outputLayers.length === 0) {
    issues.push({
      code: 'no-output-layer',
      message: 'No output layers. Enable Output on at least one layer.',
    });
  }
  for (const layer of outputLayers) {
    appendCncLayerIssues(layer, project.device.maxFeed, config, issues);
  }
  appendBoundsIssues(project, gcode, options, issues);
  appendNoGoZoneIssues(project, gcode, options, issues);
  appendPlungedTravelIssues(gcode, config, issues);
  appendOverdeepCutIssues(gcode, config, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push({
      code: 'empty-output',
      message:
        'No CNC toolpaths were generated. The most common cause: the bit is too wide to fit ' +
        'the shapes (pockets and inside profiles need the bit to fit within the geometry). ' +
        'Choose a smaller bit, a different cut type, or check that shapes are closed.',
    });
  }
  return { ok: issues.length === 0, issues };
}

function appendCncLayerIssues(
  layer: Layer,
  maxFeed: number,
  config: CncMachineConfig,
  issues: PreflightIssue[],
): void {
  const settings: CncLayerSettings = layer.cnc ?? DEFAULT_CNC_LAYER_SETTINGS;
  if (!(settings.depthMm > 0) || !(settings.depthPerPassMm > 0)) {
    issues.push({
      code: 'cnc-settings-invalid',
      message: `Layer ${layer.id}: cut depth and depth per pass must be greater than 0.`,
    });
  }
  appendFeedIssue(layer.id, 'feed', settings.feedMmPerMin, maxFeed, issues);
  appendFeedIssue(layer.id, 'plunge rate', settings.plungeMmPerMin, maxFeed, issues);
  if (!(settings.spindleRpm > 0) || settings.spindleRpm > config.params.spindleMaxRpm) {
    issues.push({
      code: 'cnc-settings-invalid',
      message:
        `Layer ${layer.id}: spindle ${settings.spindleRpm} RPM is outside ` +
        `(0, ${config.params.spindleMaxRpm}].`,
    });
  }
  if (settings.depthMm > config.stock.thicknessMm + THROUGH_CUT_ALLOWANCE_MM) {
    issues.push({
      code: 'cnc-depth-exceeds-stock',
      message:
        `Layer ${layer.id}: cut depth ${settings.depthMm} mm exceeds stock thickness ` +
        `${config.stock.thicknessMm} mm by more than ${THROUGH_CUT_ALLOWANCE_MM} mm. ` +
        'Reduce the depth or correct the material thickness.',
    });
  }
  // H.3: v-carve depth math is driven by the bit's tip angle — a flat end
  // mill would gouge full-width trenches at the commanded depths. H.7: the
  // layer's own bit (falling back to the machine bit) is what matters.
  const layerTool = layerCncTool(config, settings);
  if (settings.cutType === 'v-carve' && layerTool.kind !== 'v-bit') {
    issues.push({
      code: 'cnc-settings-invalid',
      message:
        `Layer ${layer.id}: V-carve requires a v-bit; the layer's bit ` +
        `("${layerTool.name}") is not one. Pick a v-bit in Material & Bit.`,
    });
  }
}

function appendFeedIssue(
  layerId: string,
  label: string,
  value: number,
  maxFeed: number,
  issues: PreflightIssue[],
): void {
  if (value > 0 && value <= maxFeed) return;
  issues.push({
    code: 'cnc-settings-invalid',
    message: `Layer ${layerId}: ${label} ${value} mm/min is outside (0, ${maxFeed}].`,
  });
}

function appendBoundsIssues(
  project: Project,
  gcode: string,
  options: CncPreflightOptions,
  issues: PreflightIssue[],
): void {
  const oob = findOutOfBoundsCoords(gcode, machineBoundsForDevice(project.device), {
    motionOffset: options.motionOffset,
  });
  for (const issue of oob.slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({ code: 'out-of-bed', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
}

function appendNoGoZoneIssues(
  project: Project,
  gcode: string,
  options: CncPreflightOptions,
  issues: PreflightIssue[],
): void {
  const zones = project.device.noGoZones.filter((zone) => zone.enabled);
  if (zones.length === 0) return;
  const collisionOptions =
    options.motionOffset === undefined ? {} : { motionOffset: options.motionOffset };
  const collisions = findNoGoZoneCollisions(
    gcode,
    zones,
    machineBoundsForDevice(project.device),
    collisionOptions,
  );
  for (const collision of collisions.slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({
      code: 'no-go-zone-collision',
      message: `Line ${collision.lineNumber}: motion crosses no-go zone "${collision.zone.name}".`,
    });
  }
}

function appendPlungedTravelIssues(
  gcode: string,
  config: CncMachineConfig,
  issues: PreflightIssue[],
): void {
  const travelIssues = findPlungedTravelIssues(gcode, { safeZMm: config.params.safeZMm });
  for (const issue of travelIssues.slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({ code: 'plunged-travel', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
}

function appendOverdeepCutIssues(
  gcode: string,
  config: CncMachineConfig,
  issues: PreflightIssue[],
): void {
  const depthIssues = findOverdeepCutIssues(gcode, {
    stockThicknessMm: config.stock.thicknessMm,
    allowanceMm: THROUGH_CUT_ALLOWANCE_MM,
  });
  for (const issue of depthIssues.slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({ code: 'cnc-overdeep-cut', message: `Line ${issue.lineNumber}: ${issue.reason}` });
  }
}
