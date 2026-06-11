// Preview-mode rendering for the workspace (F-A8). Original geometry is
// drawn at 30% opacity behind the toolpath; the toolpath itself is
// rendered as cut polylines + travel dashed lines, optionally truncated
// at a 0..1 scrubber fraction with a red head marker at the cut point.

import { canvasTheme } from '../theme/canvas-theme';
import { type Layer, type Project, type SceneObject, type Vec2 } from '../../core/scene';
import {
  buildToolpath,
  EMPTY_JOB,
  sliceToolpath,
  type JobOriginPlacement,
  type Toolpath,
  type ToolpathStep,
} from '../../core/job';
import { prepareOutput } from '../../io/gcode';
import { buildDisplayPolylines } from './display-polylines';
import { strideForSegmentBudget } from './draw-complexity';
import { strokePolylinesBatched } from './draw-vector-strokes';
import { mapToolpathToScene } from './preview-scene-frame';
import type { ViewTransform } from './view-transform';

export function drawObjectsFaint(
  ctx: CanvasRenderingContext2D,
  project: Project,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.globalAlpha = 0.3;
  const layerByColor = new Map(project.scene.layers.map((l) => [l.color, l]));
  for (const obj of project.scene.objects) {
    if (obj.kind !== 'imported-svg') continue;
    drawObjectPolylinesFaint(ctx, obj, layerByColor, view);
  }
  ctx.restore();
}

function drawObjectPolylinesFaint(
  ctx: CanvasRenderingContext2D,
  obj: SceneObject,
  layerByColor: Map<string, Layer>,
  view: ViewTransform,
): void {
  if (obj.kind !== 'imported-svg') return;
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
): void {
  if (toolpath.totalLength === 0) return;
  const sliced = sliceToolpath(toolpath, scrubberT * toolpath.totalLength);
  drawWholeSteps(ctx, sliced.whole, view);
  if (sliced.partial !== null) drawStep(ctx, sliced.partial, view);
  if (sliced.head !== null && scrubberT < 1) drawHead(ctx, sliced.head, view);
}

export function buildPreviewToolpath(
  project: Project,
  options: { readonly jobOrigin?: JobOriginPlacement } = {},
): Toolpath {
  // Use the SAME prepared job (compile + optimize) as Save/Start so the preview
  // shows the exact path ORDER the machine runs (roadmap P1-C). An over-budget
  // raster prepares to nothing -> empty preview (matching the too-large
  // estimate), never a freeze.
  const prepared = prepareOutput(
    project,
    options.jobOrigin === undefined ? {} : { jobOrigin: options.jobOrigin },
  );
  if (!prepared.ok) return buildToolpath(EMPTY_JOB);
  // The prepared job is in machine/work coordinates; the canvas (ghost +
  // raster sim) draws in scene space. Map back so the overlay registers with
  // the design instead of mirroring about the bed midline (H3).
  return mapToolpathToScene(buildToolpath(prepared.job), prepared.jobOriginOffset, project.device);
}

function drawStep(ctx: CanvasRenderingContext2D, step: ToolpathStep, view: ViewTransform): void {
  if (step.kind === 'travel') drawTravel(ctx, step.from, step.to, view);
  else drawCut(ctx, step.polyline, step.color, view);
}

function drawWholeSteps(
  ctx: CanvasRenderingContext2D,
  steps: ReadonlyArray<ToolpathStep>,
  view: ViewTransform,
): void {
  const stride = strideForSegmentBudget(steps.length);
  if (stride <= 1) {
    for (const step of steps) drawStep(ctx, step, view);
    return;
  }

  let lastDrawnIndex = -1;
  for (let i = 0; i < steps.length; i += stride) {
    const step = steps[i];
    if (step === undefined) continue;
    drawStep(ctx, step, view);
    lastDrawnIndex = i;
  }

  const finalIndex = steps.length - 1;
  if (finalIndex > lastDrawnIndex) {
    const finalStep = steps[finalIndex];
    if (finalStep !== undefined) drawStep(ctx, finalStep, view);
  }
}

function drawHead(ctx: CanvasRenderingContext2D, head: Vec2, view: ViewTransform): void {
  const cx = view.offsetX + head.x * view.scale;
  const cy = view.offsetY + head.y * view.scale;
  ctx.save();
  ctx.fillStyle = canvasTheme.previewHeadFill;
  ctx.strokeStyle = canvasTheme.previewHeadStroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
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
  color: string,
  view: ViewTransform,
): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
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
