// runPreflight — runs WORKFLOW.md F-A10's six pre-write checks against a
// Project and its emitted G-code. Returns a list of issues; an empty list
// means safe-to-write. Pure: no I/O.
//
// Checks (per WORKFLOW.md F-A10, in order):
//   1. At least one output layer exists.
//   2. All output geometry fits inside the bed.
//   3. Power values within 0..100 for every output layer.
//   4. Speed values within (0, device.maxFeed].
//   5. Passes ≥ 1 (integer) for every output layer.
//   6. Generated G-code is non-empty (at least one G1 line).
//
import {
  assertNever,
  isClosedEnough,
  outputOperationLayers,
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
} from '../scene';
import {
  findLaserOnTravelIssues,
  findLongBlankFeedMoves,
  findNonFiniteCoords,
  findOutOfBoundsCoords,
  type MotionBoundsOffset,
} from '../invariants';
import { machineBoundsForDevice, resolveGrblDialect } from '../devices';
import { DEFAULT_OVERSCAN_MM } from '../job';
import { findLayerModeMismatchIssues } from './layer-mode-preflight';
import { findMachineProfilePreflightIssues } from './machine-profile-preflight';
import { findNoGoZoneCollisions } from './no-go-zones';
import { findRelativeMotionEnvelopeIssues } from './relative-motion-envelope';

export type PreflightCode =
  | 'no-output-layer'
  | 'out-of-bed'
  | 'power-out-of-range'
  | 'speed-out-of-range'
  | 'passes-below-one'
  | 'layer-mode-mismatch'
  | 'offset-fill-open-contour'
  | 'machine-island-fill-risk'
  | 'unsupported-raster-transform'
  | 'laser-on-travel'
  | 'long-blank-feed'
  | 'no-go-zone-collision'
  | 'raster-too-large'
  | 'registration-both-output'
  | 'selected-output-empty'
  | 'cnc-settings-invalid'
  | 'cnc-layer-empty'
  | 'cnc-depth-exceeds-stock'
  | 'cnc-overdeep-cut'
  | 'plunged-travel'
  | 'relief-needs-cnc'
  | 'non-finite-coordinate'
  // ADR-127: image engraves are refused while the rotary is enabled (v1).
  | 'rotary-raster-unsupported'
  | 'empty-output';

export type PreflightIssue = {
  readonly code: PreflightCode;
  readonly message: string;
};

export type PreflightResult = {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<PreflightIssue>;
};

export type PreflightOptions = {
  readonly motionOffset?: MotionBoundsOffset | undefined;
  readonly coordinateMode?: 'machine' | 'relative-origin';
  // Rotary (ADR-127): the Y limit is one object revolution, not the bed —
  // overrides the height used by the bounds checks when set.
  readonly boundsHeightOverrideMm?: number;
};

const MAX_BOUNDS_ISSUES = 5;

// Blocking threshold for long laser-off FEED moves (G1 with effective S0), in
// mm. Matches ADR-035's fill gap-rapid split (gaps > 5 mm become G0 rapids), so
// fresh output never trips this; a hit means a regression or a stale export
// from before the fix. Do NOT lower in code until the A/B burn threshold
// experiment is done (roadmap P2-B).
const LONG_BLANK_FEED_THRESHOLD_MM = 5;

export function runPreflight(
  project: Project,
  gcode: string,
  options: PreflightOptions = {},
): PreflightResult {
  const issues: PreflightIssue[] = [];
  const outputLayers = project.scene.layers.flatMap(outputOperationLayers);

  if (outputLayers.length === 0) {
    issues.push({
      code: 'no-output-layer',
      message: 'No output layers. Enable Output on at least one layer.',
    });
  }

  for (const layer of outputLayers) {
    appendLayerIssues(layer, project.device.maxFeed, issues);
  }

  issues.push(...findLayerModeMismatchIssues(project.scene.objects, outputLayers));

  appendOffsetFillOpenContourIssues(project.scene, outputLayers, issues);

  appendUnsupportedRasterTransformIssues(project.scene, outputLayers, issues);

  issues.push(...findMachineProfilePreflightIssues(project));

  appendBoundsIssues(project, gcode, issues, options);

  appendNonFiniteCoordIssues(gcode, issues);

  appendNoGoZoneIssues(project, gcode, issues, options);

  appendLaserOnTravelIssues(gcode, issues);

  appendLongBlankFeedIssues(project, gcode, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push(emptyOutputIssue(project, outputLayers));
  }

  return { ok: issues.length === 0, issues };
}

// A relief-only scene is the one EXPECTED way a laser compile comes back
// empty (reliefs are CNC-only geometry) — name that instead of reporting an
// internal error.
function emptyOutputIssue(project: Project, outputLayers: ReadonlyArray<Layer>): PreflightIssue {
  const outputColors = new Set(outputLayers.map((layer) => layer.color));
  const hasOutputRelief = project.scene.objects.some(
    (object) => object.kind === 'relief' && outputColors.has(object.color),
  );
  if (hasOutputRelief) {
    return {
      code: 'relief-needs-cnc',
      message:
        'Relief objects only carve in CNC mode — switch the machine type to CNC, ' +
        'or add vector artwork for the laser.',
    };
  }
  return {
    code: 'empty-output',
    message: 'Internal error: G-code generation produced no cuts.',
  };
}

function appendNoGoZoneIssues(
  project: Project,
  gcode: string,
  issues: PreflightIssue[],
  options: PreflightOptions,
): void {
  const zones = project.device.noGoZones.filter((zone) => zone.enabled);
  if (zones.length === 0) return;
  if (options.coordinateMode === 'relative-origin' && options.motionOffset === undefined) {
    issues.push({
      code: 'no-go-zone-collision',
      message: 'No-go zones require trusted machine position for relative-origin output.',
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
  for (const collision of collisions.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'no-go-zone-collision',
      message: `Line ${collision.lineNumber}: motion crosses no-go zone "${collision.zone.name}".`,
    });
  }
}

function appendLayerIssues(layer: Layer, maxFeed: number, issues: PreflightIssue[]): void {
  const powerInRange = layer.power >= 0 && layer.power <= 100;
  const minPowerInRange = layer.minPower >= 0 && layer.minPower <= 100;
  if (!powerInRange) {
    issues.push({
      code: 'power-out-of-range',
      message: `Layer ${layer.id} power ${layer.power} is outside 0..100.`,
    });
  }
  if (!minPowerInRange) {
    issues.push({
      code: 'power-out-of-range',
      message: `Layer ${layer.id} min power ${layer.minPower} is outside 0..100.`,
    });
  }
  if (powerInRange && minPowerInRange && layer.minPower > layer.power) {
    issues.push({
      code: 'power-out-of-range',
      message: `Layer ${layer.id} min power ${layer.minPower} exceeds max power ${layer.power}.`,
    });
  }
  if (layerSpeedOutOfRange(layer.speed, maxFeed)) {
    issues.push({
      code: 'speed-out-of-range',
      message: `Layer ${layer.id} speed ${layer.speed} is outside 1..${maxFeed}.`,
    });
  }
  if (!Number.isInteger(layer.passes) || layer.passes < 1) {
    issues.push({
      code: 'passes-below-one',
      message: `Layer ${layer.id} passes ${layer.passes} must be an integer ≥ 1.`,
    });
  }
}

function layerSpeedOutOfRange(speed: number, maxFeed: number): boolean {
  return !Number.isFinite(speed) || speed <= 0 || speed > maxFeed;
}

function appendOffsetFillOpenContourIssues(
  scene: Scene,
  outputLayers: ReadonlyArray<Layer>,
  issues: PreflightIssue[],
): void {
  for (const layer of outputLayers) {
    const layerFillLabel = openContourFillLabel(layer);
    if (layerFillLabel !== null) {
      appendOpenContourIssueForLayer(scene.objects, layer, layerFillLabel, issues);
      continue;
    }
    const overrideFillLabel = openContourOverrideFillLabel(scene.objects, layer);
    if (overrideFillLabel !== null) {
      appendOffsetFillOpenContourIssue(layer, overrideFillLabel, issues);
    }
  }
}

function openContourFillLabel(layer: Layer): string | null {
  if (layer.mode !== 'fill') return null;
  if (layer.fillStyle === 'offset') return 'Offset Fill';
  if (layer.fillStyle === 'island') return 'Island Fill';
  return null;
}

function appendOpenContourIssueForLayer(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
  label: string,
  issues: PreflightIssue[],
): void {
  if (!objects.some((obj) => objectHasOpenContourOnLayer(obj, layer))) return;
  appendOffsetFillOpenContourIssue(layer, label, issues);
}

function appendOffsetFillOpenContourIssue(
  layer: Layer,
  label: string,
  issues: PreflightIssue[],
): void {
  issues.push({
    code: 'offset-fill-open-contour',
    message: `Layer ${layer.id} uses ${label} but has open vector contours assigned. Close the shapes or use Scanline Fill.`,
  });
}

function openContourOverrideFillLabel(
  objects: ReadonlyArray<SceneObject>,
  layer: Layer,
): string | null {
  for (const obj of objects) {
    const override = obj.operationOverride;
    if (override === undefined) continue;
    const effectiveLayer: Layer = { ...layer, ...override };
    if (effectiveLayer.mode !== 'fill') continue;
    if (!objectHasOpenContourOnLayer(obj, effectiveLayer)) continue;
    if (effectiveLayer.fillStyle === 'offset') return 'Follow Shape';
    if (effectiveLayer.fillStyle === 'island') return 'Island Fill';
  }
  return null;
}

function objectHasOpenContourOnLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return obj.paths.some(
        (path) =>
          path.color === layer.color &&
          path.polylines.some((polyline) => !isClosedEnough(polyline)),
      );
    case 'raster-image':
    case 'relief':
      return false;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function appendUnsupportedRasterTransformIssues(
  scene: Scene,
  outputLayers: ReadonlyArray<Layer>,
  issues: PreflightIssue[],
): void {
  const outputImageColors = new Set(
    outputLayers.filter((l) => l.mode === 'image').map((l) => l.color),
  );
  for (const obj of scene.objects) {
    if (obj.kind !== 'raster-image') continue;
    if (obj.role === 'trace-source') continue;
    if (!outputImageColors.has(obj.color)) continue;
    // Mirror is supported: compile-job's orientRasterLumaForMachine XORs the
    // object's mirror flags into the machine orientation flip (M35; pinned by
    // compile-job.test.ts column-mirror test). Only rotation remains
    // unsupported — raster emit is axis-aligned.
    if (obj.transform.rotationDeg !== 0) {
      issues.push({
        code: 'unsupported-raster-transform',
        message:
          'Image raster output currently supports scale, mirror, and position only. Clear rotation before engraving, or convert after placing the artwork.',
      });
    }
  }
}

function appendBoundsIssues(
  project: Project,
  gcode: string,
  issues: PreflightIssue[],
  options: PreflightOptions,
): void {
  const machineBounds = boundsWithHeightOverride(
    machineBoundsForDevice(project.device),
    options.boundsHeightOverrideMm,
  );
  if (options.coordinateMode === 'relative-origin' && options.motionOffset === undefined) {
    const envelopeIssues = findRelativeMotionEnvelopeIssues(gcode, {
      width: machineBounds.width,
      height: machineBounds.height,
    });
    for (const issue of envelopeIssues.slice(0, MAX_BOUNDS_ISSUES)) {
      issues.push({ code: 'out-of-bed', message: issue });
    }
    return;
  }
  const oob = findOutOfBoundsCoords(gcode, machineBounds, {
    motionOffset: options.motionOffset,
  });
  for (const issue of oob.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'out-of-bed',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    });
  }
  // M1 (AUDIT-2026-06-10): image sweeps rapid an overscan runway past each
  // side of the artwork, so an image within that distance of the bed's X
  // edges always fails bounds with a bare coordinate error — name the real
  // cause and the remedy instead of pointing at the artwork.
  const overscanMm = maxOutputOverscanMm(project.scene);
  if (oob.length > 0 && overscanMm > 0) {
    issues.push({
      code: 'out-of-bed',
      message:
        `Note: fill/image engraves can sweep ${overscanMm} mm past each side of the artwork for ` +
        `overscan (acceleration runway). If the artwork itself fits the bed, move it at least ` +
        `${overscanMm} mm inside the left/right edges.`,
    });
  }
}

// Rotary wrap limit (ADR-127): Y spans [0, override] regardless of the
// origin convention — the rotary axis has no rear rail, one revolution is
// the whole coordinate space.
function boundsWithHeightOverride(
  bounds: ReturnType<typeof machineBoundsForDevice>,
  overrideMm: number | undefined,
): ReturnType<typeof machineBoundsForDevice> {
  if (overrideMm === undefined || !Number.isFinite(overrideMm) || overrideMm <= 0) return bounds;
  return { ...bounds, height: overrideMm, minY: 0, maxY: overrideMm };
}

function maxOutputOverscanMm(scene: Scene): number {
  const outputLayers = scene.layers.flatMap(outputOperationLayers);
  const imageColors = new Set(outputLayers.filter((l) => l.mode === 'image').map((l) => l.color));
  const hasImageOutput = scene.objects.some(
    (obj) =>
      obj.kind === 'raster-image' && obj.role !== 'trace-source' && imageColors.has(obj.color),
  );
  const imageOverscan = hasImageOutput ? DEFAULT_OVERSCAN_MM : 0;
  const fillOverscan = Math.max(
    0,
    ...outputLayers.filter((l) => l.mode === 'fill').map((l) => Math.max(0, l.fillOverscanMm)),
  );
  return Math.max(imageOverscan, fillOverscan);
}

// Last line of defense against a non-finite coordinate (XNaN, X-Infinity)
// reaching the machine. The bounds scanner cannot see these — parseGcodeWord
// nulls a malformed word exactly as it nulls an absent one — so a NaN produced
// by any non-import producer (numeric edits, geometry ops, kerf/tabs) would
// otherwise pass every other check. See non-finite-coords.ts.
function appendNonFiniteCoordIssues(gcode: string, issues: PreflightIssue[]): void {
  const nonFinite = findNonFiniteCoords(gcode);
  for (const issue of nonFinite.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'non-finite-coordinate',
      message: `Line ${issue.lineNumber}: ${issue.reason}. Regenerate the output — this coordinate cannot be sent to the machine.`,
    });
  }
}

function appendLaserOnTravelIssues(gcode: string, issues: PreflightIssue[]): void {
  const travelIssues = findLaserOnTravelIssues(gcode);
  for (const issue of travelIssues.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'laser-on-travel',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    });
  }
}

// Block g-code that crawls across a long gap at cutting feed with the laser off
// (G1 ... S0). Distinct from laser-on-travel: this is the marking / stale-export
// invariant (the "moved to the second part and left a stray line" class). Fresh
// post-ADR-035 output is clean; a hit means a regression or an old export.
function appendLongBlankFeedIssues(
  project: Project,
  gcode: string,
  issues: PreflightIssue[],
): void {
  if (usesControlledLaserOffTravel(project)) return;
  const blankFeed = findLongBlankFeedMoves(gcode, { thresholdMm: LONG_BLANK_FEED_THRESHOLD_MM });
  for (const issue of blankFeed.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'long-blank-feed',
      message: `Line ${issue.lineNumber}: blank G1 feed move ${issue.distanceMm.toFixed(3)} mm exceeds ${LONG_BLANK_FEED_THRESHOLD_MM.toFixed(3)} mm. Regenerate output or lower the fill blank-feed threshold after hardware verification.`,
    });
  }
}

function usesControlledLaserOffTravel(project: Project): boolean {
  const feed = resolveGrblDialect(project.device).controlledLaserOffTravelFeedMmPerMin;
  return typeof feed === 'number' && Number.isFinite(feed) && feed > 0;
}
