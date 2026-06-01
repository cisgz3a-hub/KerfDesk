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
// Phase A scope: bounds check supports front-left/right and rear-left/right
// origins (positive coord range). Center origin is documented as Phase B.

import { assertNever, type Layer, type Project, type Scene, type SceneObject } from '../scene';
import { findOutOfBoundsCoords } from '../invariants';

export type PreflightCode =
  | 'no-output-layer'
  | 'out-of-bed'
  | 'power-out-of-range'
  | 'speed-out-of-range'
  | 'passes-below-one'
  | 'layer-mode-mismatch'
  | 'unsupported-raster-transform'
  | 'empty-output';

export type PreflightIssue = {
  readonly code: PreflightCode;
  readonly message: string;
};

export type PreflightResult = {
  readonly ok: boolean;
  readonly issues: ReadonlyArray<PreflightIssue>;
};

const MAX_BOUNDS_ISSUES = 5;

export function runPreflight(project: Project, gcode: string): PreflightResult {
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

  appendBoundsIssues(project, gcode, issues);

  if (!/\bG1\b/.test(gcode)) {
    issues.push({
      code: 'empty-output',
      message: 'Internal error: G-code generation produced no cuts.',
    });
  }

  return { ok: issues.length === 0, issues };
}

function appendLayerIssues(layer: Layer, maxFeed: number, issues: PreflightIssue[]): void {
  if (layer.power < 0 || layer.power > 100) {
    issues.push({
      code: 'power-out-of-range',
      message: `Layer ${layer.id} power ${layer.power} is outside 0..100.`,
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
    if (obj.transform.rotationDeg !== 0 || obj.transform.mirrorX || obj.transform.mirrorY) {
      issues.push({
        code: 'unsupported-raster-transform',
        message:
          'Image raster output currently supports scale and position only. Clear rotation/mirror before engraving, or convert after placing the artwork.',
      });
    }
  }
}

function appendBoundsIssues(project: Project, gcode: string, issues: PreflightIssue[]): void {
  if (project.device.origin === 'center') {
    // Phase B will support bounds checking with negative-coord rectangles.
    return;
  }
  const oob = findOutOfBoundsCoords(gcode, {
    width: project.device.bedWidth,
    height: project.device.bedHeight,
  });
  for (const issue of oob.slice(0, MAX_BOUNDS_ISSUES)) {
    issues.push({
      code: 'out-of-bed',
      message: `Line ${issue.lineNumber}: ${issue.reason}`,
    });
  }
}
