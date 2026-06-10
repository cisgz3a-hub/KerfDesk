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
import { assertNever, type Layer, type Project, type Scene, type SceneObject } from '../scene';
import {
  findLaserOnTravelIssues,
  findLongBlankFeedMoves,
  findOutOfBoundsCoords,
  type MotionBoundsOffset,
} from '../invariants';
import { machineBoundsForDevice } from '../devices';

export type PreflightCode =
  | 'no-output-layer'
  | 'out-of-bed'
  | 'power-out-of-range'
  | 'speed-out-of-range'
  | 'passes-below-one'
  | 'layer-mode-mismatch'
  | 'unsupported-raster-transform'
  | 'laser-on-travel'
  | 'long-blank-feed'
  | 'raster-too-large'
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
  const outputLayers = project.scene.layers.filter((l) => l.output);

  if (outputLayers.length === 0) {
    issues.push({
      code: 'no-output-layer',
      message: 'No output layers. Enable Output on at least one layer.',
    });
  }

  for (const layer of outputLayers) {
    appendLayerIssues(layer, project.device.maxFeed, issues);
  }

  appendModeMismatchIssues(project.scene, outputLayers, issues);

  appendUnsupportedRasterTransformIssues(project.scene, outputLayers, issues);

  appendBoundsIssues(project, gcode, issues, options.motionOffset);

  appendLaserOnTravelIssues(gcode, issues);

  appendLongBlankFeedIssues(gcode, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push({
      code: 'empty-output',
      message: 'Internal error: G-code generation produced no cuts.',
    });
  }

  return { ok: issues.length === 0, issues };
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
  if (layer.speed <= 0 || layer.speed > maxFeed) {
    issues.push({
      code: 'speed-out-of-range',
      message: `Layer ${layer.id} speed ${layer.speed} exceeds device max ${maxFeed}.`,
    });
  }
  if (!Number.isInteger(layer.passes) || layer.passes < 1) {
    issues.push({
      code: 'passes-below-one',
      message: `Layer ${layer.id} passes ${layer.passes} must be an integer ≥ 1.`,
    });
  }
}

// F4: catch objects that compileJob silently drops because their layer's
// mode won't process them. compile-job.ts only feeds raster images to
// image-mode layers and only feeds vector paths to line/fill-mode layers;
// anything assigned (by color) to the wrong mode emits no G-code and no
// error today. Flag one issue per offending OUTPUT layer so the operator
// sees "this layer won't engrave what's on it" before writing the file.
function appendModeMismatchIssues(
  scene: Scene,
  outputLayers: ReadonlyArray<Layer>,
  issues: PreflightIssue[],
): void {
  for (const layer of outputLayers) {
    if (scene.objects.some((obj) => isStrandedOnLayer(obj, layer))) {
      issues.push({ code: 'layer-mode-mismatch', message: mismatchMessage(layer) });
    }
  }
}

// True when `obj` is assigned to `layer` (by color) but `layer.mode` is the
// kind compileJob won't emit for that object — so it's silently dropped.
function isStrandedOnLayer(obj: SceneObject, layer: Layer): boolean {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
      // Vectors emit only on line/fill layers; an image layer ignores them.
      return layer.mode === 'image' && obj.paths.some((p) => p.color === layer.color);
    case 'raster-image':
      if (obj.role === 'trace-source') return false;
      // Rasters emit only on image layers; a line/fill layer ignores them.
      return layer.mode !== 'image' && obj.color === layer.color;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function mismatchMessage(layer: Layer): string {
  return layer.mode === 'image'
    ? `Layer ${layer.id} is in Image mode but has vector objects assigned; they will not be engraved. Set the layer to Line or Fill, or move the objects to another layer.`
    : `Layer ${layer.id} is in ${layer.mode === 'fill' ? 'Fill' : 'Line'} mode but has an image assigned; it will not be engraved. Set the layer to Image mode.`;
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
  motionOffset: MotionBoundsOffset | undefined,
): void {
  const oob = findOutOfBoundsCoords(gcode, machineBoundsForDevice(project.device), {
    motionOffset,
  });
  for (const issue of oob.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'out-of-bed',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
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
function appendLongBlankFeedIssues(gcode: string, issues: PreflightIssue[]): void {
  const blankFeed = findLongBlankFeedMoves(gcode, { thresholdMm: LONG_BLANK_FEED_THRESHOLD_MM });
  for (const issue of blankFeed.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'long-blank-feed',
      message: `Line ${issue.lineNumber}: blank G1 feed move ${issue.distanceMm.toFixed(3)} mm exceeds ${LONG_BLANK_FEED_THRESHOLD_MM.toFixed(3)} mm. Regenerate output or lower the fill blank-feed threshold after hardware verification.`,
    });
  }
}
