// Preview-mode rendering for the workspace (F-A8). Original geometry is
// drawn at 30% opacity behind the toolpath; the toolpath itself is
// rendered as cut polylines + travel dashed lines, optionally truncated
// at a 0..1 scrubber fraction with a red head marker at the cut point.

import { canvasTheme } from '../theme/canvas-theme';
import {
  assertNever,
  type Layer,
  type Project,
  type SceneObject,
  type OutputScope,
  type Vec2,
  validateOutputScope,
} from '../../core/scene';
import {
  buildToolpath,
  EMPTY_JOB,
  scenePreparationTooComplex,
  sliceToolpath,
  type JobOriginPlacement,
  type Toolpath,
  type ToolpathStep,
} from '../../core/job';
import { prepareOutput } from '../../io/gcode';
import { buildDisplayPolylines } from './display-polylines';
import { strideForSegmentBudget } from './draw-complexity';
import { strokePolylinesBatched } from './draw-vector-strokes';
import type { PreviewIssue, PreviewToolpath } from './preview-status';
import { mapToolpathToScene } from './preview-scene-frame';
import type { ViewTransform } from './view-transform';

type FaintVectorObject = Extract<
  SceneObject,
  { readonly kind: 'imported-svg' | 'text' | 'traced-image' | 'shape' }
>;

export function drawObjectsFaint(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const layerByColor = new Map(project.scene.layers.map((l) => [l.color, l]));
  for (const obj of project.scene.objects) {
    if (!hasFaintVectorGeometry(obj)) continue;
    drawObjectPolylinesFaint(ctx, obj, layerByColor, view);
  }
  ctx.restore();
}

function hasFaintVectorGeometry(obj: SceneObject): obj is FaintVectorObject {
  switch (obj.kind) {
    case 'imported-svg':
    case 'text':
    case 'traced-image':
    case 'shape':
      return true;
    case 'raster-image':
      return false;
    default:
      return assertNever(obj, 'SceneObject');
  }
}

function drawObjectPolylinesFaint(
  ctx: CanvasRenderingContext2D,
  obj: FaintVectorObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
): void {
  if (!hasFaintVectorGeometry(obj)) return;
  for (const path of obj.paths) {
    const layer = layerByColor.get(path.color);
    if (layer === undefined || !layer.visible) continue;
    ctx.strokeStyle = path.color;
    ctx.lineWidth = layer.output ? 1.5 : 0.75;
    const display = buildDisplayPolylines(path.polylines);
    strokePolylinesBatched(ctx, obj, display.polylines, view);
  }
}

export function drawPreview(
  ctx: CanvasRenderingContext2D,
  toolpath: Toolpath,
  view: ViewTransform,
  scrubberT: number,
  options: {
    readonly showTravel?: boolean;
    readonly showFuture?: boolean;
    readonly showEndpoints?: boolean;
  } = {},
): void {
  if (toolpath.totalLength === 0) return;
  const showTravel = options.showTravel !== false;
  const showFuture = options.showFuture !== false;
  const showEndpoints = options.showEndpoints !== false;
  if (showFuture && scrubberT < 1) {
    ctx.save();
    ctx.globalAlpha = 0.18;
    drawWholeSteps(ctx, toolpath.steps, view, showTravel);
    ctx.restore();
  }
  const sliced = sliceToolpath(toolpath, scrubberT * toolpath.totalLength);
  ctx.save();
  ctx.globalAlpha = 0.72;
  drawWholeSteps(ctx, sliced.whole, view, showTravel);
  if (sliced.partial !== null) drawStep(ctx, sliced.partial, view, showTravel);
  ctx.restore();
  if (showEndpoints) drawEndpoints(ctx, toolpath.steps, view);
  if (sliced.head !== null && scrubberT < 1) drawHead(ctx, sliced.head, view);
}

export function buildPreviewToolpath(
  project: Project,
  options: { readonly jobOrigin?: JobOriginPlacement; readonly outputScope?: OutputScope } = {},
): PreviewToolpath {
  // Use the SAME prepared job (compile + optimize) as Save/Start so the preview
  // shows the exact path ORDER the machine runs (roadmap P1-C). Cheap scoped
  // complexity gates run first so huge traces/fills never reach synchronous
  // compile. Over-budget rasters still fail in prepareOutput before large work.
  const scoped =
    options.outputScope === undefined
      ? null
      : validateOutputScope(project.scene, options.outputScope);
  if (scoped !== null && !scoped.ok) return buildToolpath(EMPTY_JOB);
  const complexityScene = scoped === null ? project.scene : scoped.scene;
  if (scenePreparationTooComplex(complexityScene)) return emptyPreviewToolpath('too-complex');
  const prepared = prepareOutput(project, {
    ...(options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin }),
    ...(options.outputScope === undefined ? {} : { outputScope: options.outputScope }),
  });
  if (!prepared.ok) return buildToolpath(EMPTY_JOB);
  // The prepared job is in machine/work coordinates; the canvas (ghost +
  // raster sim) draws in scene space. Map back so the overlay registers with
  // the design instead of mirroring about the bed midline (H3).
  return mapToolpathToScene(buildToolpath(prepared.job), prepared.jobOriginOffset, project.device);
}

function emptyPreviewToolpath(previewIssue: PreviewIssue): PreviewToolpath {
  return { ...buildToolpath(EMPTY_JOB), previewIssue };
}

function drawStep(
  ctx: CanvasRenderingContext2D,
  step: ToolpathStep,
  view: ViewTransform,
  showTravel: boolean,
): void {
  if (step.kind === 'travel') {
    if (showTravel) drawTravel(ctx, step.from, step.to, view);
  } else drawCut(ctx, step.polyline, step.color, view);
}

function drawWholeSteps(
  ctx: CanvasRenderingContext2D,
  steps: ReadonlyArray<ToolpathStep>,
  view: ViewTransform,
  showTravel: boolean,
): void {
  const stride = strideForSegmentBudget(steps.length);
  if (stride <= 1) {
    for (const step of steps) drawStep(ctx, step, view, showTravel);
    return;
  }

  let lastDrawnIndex = -1;
  for (let i = 0; i < steps.length; i += stride) {
    const step = steps[i];
    if (step === undefined) continue;
    drawStep(ctx, step, view, showTravel);
    lastDrawnIndex = i;
  }

  const finalIndex = steps.length - 1;
  if (finalIndex > lastDrawnIndex) {
    const finalStep = steps[finalIndex];
    if (finalStep !== undefined) drawStep(ctx, finalStep, view, showTravel);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, head: Vec2, view: ViewTransform): void {
  drawRouteMarker(ctx, head, view, 5, canvasTheme.previewHeadFill, canvasTheme.previewHeadStroke);
}

function drawEndpoints(
  ctx: CanvasRenderingContext2D,
  steps: ReadonlyArray<ToolpathStep>,
  view: ViewTransform,
): void {
  const start = firstRoutePoint(steps);
  const end = lastRoutePoint(steps);
  if (start !== null) {
    drawRouteMarker(ctx, start, view, 3.5, canvasTheme.previewHeadStroke, canvasTheme.previewTravel);
  }
  if (end !== null) {
    drawRouteMarker(ctx, end, view, 3.5, canvasTheme.previewTravel, canvasTheme.previewHeadStroke);
  }
}

function drawRouteMarker(
  ctx: CanvasRenderingContext2D,
  head: Vec2,
  view: ViewTransform,
  radiusPx: number,
  fillStyle: string,
  strokeStyle: string,
): void {
  const cx = view.offsetX + head.x * view.scale;
  const cy = view.offsetY + head.y * view.scale;
  ctx.save();
  ctx.fillStyle = fillStyle;
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTravel(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.previewTravel;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(view.offsetX + from.x * view.scale, view.offsetY + from.y * view.scale);
  ctx.lineTo(view.offsetX + to.x * view.scale, view.offsetY + to.y * view.scale);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawCut(
  ctx: CanvasRenderingContext2D,
  polyline: ReadonlyArray<Vec2>,
  _color: string,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.previewCut;
  ctx.lineWidth = 1;
  ctx.beginPath();
  const stride = strideForSegmentBudget(Math.max(0, polyline.length - 1));
  if (stride > 1) {
    for (let i = 1; i < polyline.length; i += stride) {
      const from = polyline[i - 1];
      const to = polyline[i];
      if (from === undefined || to === undefined) continue;
      ctx.moveTo(view.offsetX + from.x * view.scale, view.offsetY + from.y * view.scale);
      ctx.lineTo(view.offsetX + to.x * view.scale, view.offsetY + to.y * view.scale);
    }
  } else {
    for (let i = 0; i < polyline.length; i += 1) {
      const p = polyline[i];
      if (p === undefined) continue;
      const cx = view.offsetX + p.x * view.scale;
      const cy = view.offsetY + p.y * view.scale;
      if (i === 0) ctx.moveTo(cx, cy);
      else ctx.lineTo(cx, cy);
    }
  }
  ctx.stroke();
}

function firstRoutePoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  const first = steps[0];
  if (first === undefined) return null;
  return first.kind === 'travel' ? first.from : (first.polyline[0] ?? null);
}

function lastRoutePoint(steps: ReadonlyArray<ToolpathStep>): Vec2 | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const step = steps[i];
    if (step === undefined) continue;
    if (step.kind === 'travel') return step.to;
    const end = step.polyline[step.polyline.length - 1];
    if (end !== undefined) return end;
  }
  return null;
}
