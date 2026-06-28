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
  type Layer,
  type Project,
  type Scene,
  type SceneObject,
} from '../scene';
import {
  findLaserOnTravelIssues,
  findLongBlankFeedMoves,
  findOutOfBoundsCoords,
  type MotionBoundsOffset,
} from '../invariants';
import { machineBoundsForDevice, resolveGrblDialect } from '../devices';
import { DEFAULT_OVERSCAN_MM } from '../job';
import { findNoGoZoneCollisions } from './no-go-zone-preflight';

export type PreflightCode =
  | 'no-output-layer'
  | 'out-of-bed'
  | 'power-out-of-range'
  | 'speed-out-of-range'
  | 'passes-below-one'
  | 'layer-mode-mismatch'
  | 'offset-fill-open-contour'
  | 'unsupported-raster-transform'
  | 'laser-on-travel'
  | 'long-blank-feed'
  | 'no-go-zone-collision'
  | 'raster-too-large'
  | 'registration-both-output'
  | 'selected-output-empty'
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

  appendOffsetFillOpenContourIssues(project.scene, outputLayers, issues);

  appendUnsupportedRasterTransformIssues(project.scene, outputLayers, issues);

  appendBoundsIssues(project, gcode, issues, options);

  appendNoGoZoneIssues(project, gcode, issues, options);

  appendLaserOnTravelIssues(gcode, issues);

  appendLongBlankFeedIssues(project, gcode, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push({
      code: 'empty-output',
      message: 'Internal error: G-code generation produced no cuts.',
    });
  }

  return { ok: issues.length === 0, issues };
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
  const offset = options.motionOffset ?? { x: 0, y: 0 };
  const collisions = findNoGoZoneCollisions(gcode, zones, offset);
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
    case 'shape':
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
  const machineBounds = machineBoundsForDevice(project.device);
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
  const oob = findOutOfBoundsCoords(gcode, machineBoundsForDevice(project.device), {
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

function findRelativeMotionEnvelopeIssues(
  gcode: string,
  bed: { readonly width: number; readonly height: number },
): ReadonlyArray<string> {
  const bounds = collectRelativeMotionEnvelope(gcode);
  if (bounds === null) return [];
  const issues: string[] = [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (width > bed.width) {
    issues.push(
      `Relative job motion spans ${width.toFixed(3)} mm in X, exceeding the ${bed.width} mm bed width. Scale the artwork down or reduce overscan.`,
    );
  }
  if (height > bed.height) {
    issues.push(
      `Relative job motion spans ${height.toFixed(3)} mm in Y, exceeding the ${bed.height} mm bed height. Scale the artwork down.`,
    );
  }
  return issues;
}

function collectRelativeMotionEnvelope(gcode: string): {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
} | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let any = false;
  for (const raw of gcode.split('\n')) {
    const stripped = raw.split(';', 1)[0]?.trim() ?? '';
    if (!/^G[0123]\b/.test(stripped)) continue;
    const x = parseMotionAxis(stripped, 'X');
    const y = parseMotionAxis(stripped, 'Y');
    if (x !== null) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      any = true;
    }
    if (y !== null) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      any = true;
    }
  }
  return any ? { minX, minY, maxX, maxY } : null;
}

function parseMotionAxis(line: string, axis: 'X' | 'Y'): number | null {
  const match = new RegExp(String.raw`\b${axis}(-?\d+(?:\.\d+)?)`).exec(line);
  return match?.[1] === undefined ? null : Number.parseFloat(match[1]);
}

function maxOutputOverscanMm(scene: Scene): number {
  const imageColors = new Set(
    scene.layers.filter((l) => l.output && l.mode === 'image').map((l) => l.color),
  );
  const hasImageOutput = scene.objects.some(
    (obj) =>
      obj.kind === 'raster-image' && obj.role !== 'trace-source' && imageColors.has(obj.color),
  );
  const imageOverscan = hasImageOutput ? DEFAULT_OVERSCAN_MM : 0;
  const fillOverscan = Math.max(
    0,
    ...scene.layers
      .filter((l) => l.output && l.mode === 'fill')
      .map((l) => Math.max(0, l.fillOverscanMm)),
  );
  return Math.max(imageOverscan, fillOverscan);
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
