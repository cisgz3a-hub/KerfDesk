// runCncPreflight — pre-write checks for CNC (router) jobs. The CNC analog of
// runPreflight: an empty issue list means safe-to-write. Pure: no I/O.
//
// Checks:
//   1. At least one output layer exists.
//   2. Spindle spin-up dwell is a positive finite duration.
//   3. Per-layer CNC settings are sane: depth > 0, depth/pass > 0, feeds in
//      (0, device.maxFeed], spindle RPM in (0, spindleMaxRpm].
//   4. Cut depth does not exceed stock thickness by more than the through-cut
//      allowance (cutting into the spoilboard beyond that is a setup error).
//   5. All motion fits inside the bed (shared bounds scanner).
//   6. No-go zones are respected (shared scanner — clamps matter on a router).
//   7. Z is up on every XY rapid; no rapid plunges (findPlungedTravelIssues).
//   8. Generated G-code is non-empty (at least one G1 line).
//   9. No emitted Z below -(stock + through-cut allowance) — proves the depth
//      invariant on the final text, not just the settings (findOverdeepCutIssues).

import {
  findCncAdaptivePocketIssues,
  findCncHelicalEntryIssues,
  findCncInlayIssues,
  findCncRestPocketIssues,
  findDroppedCncLayers,
} from '../cnc';
import { machineBoundsForDevice } from '../devices';
import {
  DEFAULT_THROUGH_CUT_ALLOWANCE_MM,
  findNonFiniteCoords,
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
  readonly coordinateMode?: 'machine' | 'relative-origin';
  // A Verified Origin's mandatory frame trace substitutes for the no-go-zone
  // crossing check that can't run without a trusted offset (G9/G19/G20).
  readonly originVerifiedByFrame?: boolean;
};

const MAX_REPORTED_ISSUES = 5;
const MIN_SPINDLE_SPINUP_SEC = 0.5;
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
  appendCncMachineIssues(config, issues);
  for (const layer of outputLayers) {
    appendCncLayerIssues(layer, project.device.maxFeed, config, issues);
  }
  // A layer with shapes but zero toolpaths would be SILENTLY omitted from
  // the job (bit too wide for the geometry, or open shapes on a closed-only
  // cut type) — the customer finds out after the cut.
  for (const layerId of findDroppedCncLayers(project.scene, project.device, config)) {
    issues.push({
      code: 'cnc-layer-empty',
      message:
        `Layer ${layerId}: its shapes produced no toolpaths — usually the bit is too wide to ` +
        'fit them (pockets and inside profiles need the bit to fit inside), or a profile/pocket ' +
        'shape is not closed. Fix the layer or disable its Output.',
    });
  }
  for (const issue of findCncHelicalEntryIssues(project.scene, project.device, config)) {
    issues.push({
      code: 'cnc-helix-entry-invalid',
      message: `Layer ${issue.layerId}: ${issue.reason} Adjust Helical entry or disable it.`,
    });
  }
  for (const issue of findCncRestPocketIssues(project.scene, project.device, config)) {
    issues.push({
      code: 'cnc-rest-machining-invalid',
      message: `Layer ${issue.layerId}: ${issue.reason} Adjust Rough first or disable it.`,
    });
  }
  for (const issue of findCncAdaptivePocketIssues(project.scene, project.device, config)) {
    issues.push({
      code: 'cnc-adaptive-clearing-invalid',
      message: `Layer ${issue.layerId}: ${issue.reason} Adjust Optimal load or choose another fill method.`,
    });
  }
  for (const issue of findCncInlayIssues(project.scene, project.device, config)) {
    issues.push({
      code: 'cnc-inlay-invalid',
      message: `Layer ${issue.layerId}: ${issue.reason} Adjust the inlay settings or choose another bit.`,
    });
  }
  appendBoundsIssues(project, gcode, options, issues);
  appendNonFiniteCoordIssues(gcode, issues);
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

function appendCncMachineIssues(config: CncMachineConfig, issues: PreflightIssue[]): void {
  const spinupSec = config.params.spindleSpinupSec;
  if (Number.isFinite(spinupSec) && spinupSec >= MIN_SPINDLE_SPINUP_SEC) return;
  issues.push({
    code: 'cnc-settings-invalid',
    message:
      'CNC spindle spin-up delay must be at least 0.5 seconds. Set enough time for the spindle to reach cutting speed before the first plunge.',
  });
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

// See preflight.ts appendNonFiniteCoordIssues — a NaN/Infinity Z plunge or XY
// coordinate is invisible to the bounds scanner and would fault the controller.
function appendNonFiniteCoordIssues(gcode: string, issues: PreflightIssue[]): void {
  for (const issue of findNonFiniteCoords(gcode).slice(0, MAX_REPORTED_ISSUES)) {
    issues.push({
      code: 'non-finite-coordinate',
      message: `Line ${issue.lineNumber}: ${issue.reason}. Regenerate the output — this coordinate cannot be sent to the machine.`,
    });
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
  if (options.coordinateMode === 'relative-origin' && options.motionOffset === undefined) {
    // A hand-set (relative) origin has no trusted work→machine offset, so
    // scanning work-coordinate G-code against the machine-frame zones with a zero
    // offset is a wrong-frame check that can FALSE-PASS a job straight through a
    // clamp (G20). A Verified Origin's mandatory frame trace proves clearance
    // instead (ADR-053) and substitutes for the check; every other
    // relative-origin start fails closed rather than trusting a fictional frame.
    if (options.originVerifiedByFrame === true) return;
    issues.push({
      code: 'no-go-zone-collision',
      message:
        'No-go zones can’t be checked from a hand-set origin without homing. Frame the job in ' +
        'Verified Origin mode to confirm clearance, or disable the zone.',
    });
    return;
  }
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
