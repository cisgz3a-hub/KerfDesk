// Preview-mode rendering for the workspace (F-A8). Original geometry is
// drawn at 30% opacity behind the toolpath; the toolpath itself is
// rendered as cut polylines + travel dashed lines, optionally truncated
// at a 0..1 scrubber fraction with a red head marker at the cut point.

import {
  applyTransform,
  type Layer,
  type Project,
  type SceneObject,
  type Vec2,
} from '../../core/scene';
import {
  buildToolpath,
  compileJob,
  sliceToolpath,
  type Toolpath,
  type ToolpathStep,
} from '../../core/job';
import { strideForSegmentBudget } from './draw-complexity';
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
    for (const polyline of path.polylines) {
      ctx.beginPath();
      for (let i = 0; i < polyline.points.length; i += 1) {
        const raw = polyline.points[i];
        if (raw === undefined) continue;
        const p = applyTransform(raw, obj.transform);
        const cx = view.offsetX + p.x * view.scale;
        const cy = view.offsetY + p.y * view.scale;
        if (i === 0) ctx.moveTo(cx, cy);
        else ctx.lineTo(cx, cy);
      }
      ctx.stroke();
    }
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
  for (const step of sliced.whole) drawStep(ctx, step, view);
  if (sliced.partial !== null) drawStep(ctx, sliced.partial, view);
  if (sliced.head !== null && scrubberT < 1) drawHead(ctx, sliced.head, view);
}

export function buildPreviewToolpath(project: Project): Toolpath {
  return buildToolpath(compileJob(project.scene, project.device));
}

function drawStep(ctx: CanvasRenderingContext2D, step: ToolpathStep, view: ViewTransform): void {
  if (step.kind === 'travel') drawTravel(ctx, step.from, step.to, view);
  else drawCut(ctx, step.polyline, step.color, view);
}

function drawHead(ctx: CanvasRenderingContext2D, head: Vec2, view: ViewTransform): void {
  const cx = view.offsetX + head.x * view.scale;
  const cy = view.offsetY + head.y * view.scale;
  ctx.save();
  ctx.fillStyle = '#ff3b30';
  ctx.strokeStyle = '#fff';
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
  ctx.strokeStyle = '#bbbbbb';
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
