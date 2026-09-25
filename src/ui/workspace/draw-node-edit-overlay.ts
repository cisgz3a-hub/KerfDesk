// Node-editor feedback layer (ADR-376): the node or segment under the pointer,
// the segment picked by clicking it, and during a drag the open end it will
// join, the node or midpoint it snapped to, or its Shift guide. Painted on its
// own canvas so following the pointer never repaints the artwork.

import {
  applyTransform,
  type PathSegment,
  type Project,
  type SceneObject,
  type Transform,
  type Vec2,
} from '../../core/scene';
import { sampleSegment, segmentStartPoint } from '../../core/geometry/curve-segment-geometry';
import { canvasTheme } from '../theme/canvas-theme';
import type { PathSegmentRef } from '../state/path-segment-ref';
import type { NodeDragFeedback } from './node-edit-store';
import { pathNodeScenePoint, type NodeEditHover } from './node-edit-target';
import { sampledSubpaths } from './path-segment-hit-test';
import type { ViewTransform } from './view-transform';

const SEGMENT_WIDTH_PX = 3;
const NODE_RING_PX = 7;
const JOIN_RING_PX = 10;
const SNAP_MARK_PX = 5;

export function drawNodeEditOverlay(
  ctx: CanvasRenderingContext2D,
  args: {
    readonly project: Project;
    readonly view: ViewTransform;
    readonly hover: NodeEditHover | null;
    readonly selectedSegment: PathSegmentRef | null;
    readonly feedback: NodeDragFeedback | null;
  },
): void {
  const { project, view } = args;
  if (args.selectedSegment !== null) {
    strokeSegment(ctx, project, args.selectedSegment, view, canvasTheme.pathSegmentSelected);
  }
  if (args.hover?.kind === 'segment') {
    strokeSegment(ctx, project, args.hover.hit.ref, view, canvasTheme.pathSegmentHover);
  } else if (args.hover?.kind === 'node') {
    const point = pathNodeScenePoint(project, args.hover.ref);
    if (point !== null) ring(ctx, screen(point, view), NODE_RING_PX, canvasTheme.pathSegmentHover);
  }
  drawDragFeedback(ctx, args.feedback, view);
}

function drawDragFeedback(
  ctx: CanvasRenderingContext2D,
  feedback: NodeDragFeedback | null,
  view: ViewTransform,
): void {
  if (feedback === null) return;
  if (feedback.constraint !== null) {
    constraintGuide(ctx, feedback.constraint.from, feedback.constraint.to, view);
  }
  if (feedback.snapPoint !== null) snapMark(ctx, screen(feedback.snapPoint, view));
  if (feedback.join !== null) {
    const at = screen(feedback.join.point, view);
    ring(ctx, at, JOIN_RING_PX, canvasTheme.pathNodeJoinCue);
    ring(ctx, at, JOIN_RING_PX / 2, canvasTheme.pathNodeJoinCue);
  }
}

function strokeSegment(
  ctx: CanvasRenderingContext2D,
  project: Project,
  ref: PathSegmentRef,
  view: ViewTransform,
  color: string,
): void {
  const at = segmentAt(project, ref);
  if (at === null) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = SEGMENT_WIDTH_PX;
  ctx.lineCap = 'round';
  ctx.beginPath();
  traceSegment(ctx, at.object, at.from, at.segment, view);
  ctx.stroke();
  ctx.restore();
}

function segmentAt(
  project: Project,
  ref: PathSegmentRef,
): { readonly object: SceneObject; readonly from: Vec2; readonly segment: PathSegment } | null {
  const object = project.scene.objects.find((candidate) => candidate.id === ref.objectId);
  const path = object !== undefined && 'paths' in object ? object.paths[ref.pathIndex] : undefined;
  const subpath = path === undefined ? null : sampledSubpaths(path)[ref.polylineIndex]?.subpath;
  const segment = subpath?.segments[ref.segmentIndex];
  const from =
    subpath === undefined || subpath === null ? null : segmentStartPoint(subpath, ref.segmentIndex);
  if (object === undefined || segment === undefined || from === null) return null;
  return { object, from, segment };
}

// Lines and cubics map exactly through the affine placement; an arc is
// sampled finely enough to look smooth at the current zoom.
function traceSegment(
  ctx: CanvasRenderingContext2D,
  object: SceneObject,
  from: Vec2,
  segment: PathSegment,
  view: ViewTransform,
): void {
  const toScreen = (point: Vec2): Vec2 => screen(applyTransform(point, object.transform), view);
  const start = toScreen(from);
  ctx.moveTo(start.x, start.y);
  if (segment.kind === 'cubic') {
    const c1 = toScreen(segment.control1);
    const c2 = toScreen(segment.control2);
    const to = toScreen(segment.to);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, to.x, to.y);
    return;
  }
  const points =
    segment.kind === 'line' ? [segment.to] : arcPoints(from, segment, object.transform, view);
  for (const point of points) {
    const at = toScreen(point);
    ctx.lineTo(at.x, at.y);
  }
}

function arcPoints(
  from: Vec2,
  segment: PathSegment,
  transform: Transform,
  view: ViewTransform,
): ReadonlyArray<Vec2> {
  const scale = Math.max(Math.abs(transform.scaleX), Math.abs(transform.scaleY)) * view.scale;
  const tolerance = Number.isFinite(scale) && scale > 0 ? 0.25 / scale : 0.01;
  return sampleSegment(from, segment, tolerance)
    .slice(1)
    .map((sample) => sample.point);
}

function ring(ctx: CanvasRenderingContext2D, at: Vec2, radius: number, color: string): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function snapMark(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.save();
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(at.x, at.y - SNAP_MARK_PX);
  ctx.lineTo(at.x + SNAP_MARK_PX, at.y);
  ctx.lineTo(at.x, at.y + SNAP_MARK_PX);
  ctx.lineTo(at.x - SNAP_MARK_PX, at.y);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

// The guide runs through where the item started, across the whole canvas.
function constraintGuide(
  ctx: CanvasRenderingContext2D,
  from: Vec2,
  to: Vec2,
  view: ViewTransform,
): void {
  const start = screen(from, view);
  const end = screen(to, view);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  if (length === 0) return;
  const reach = Math.hypot(ctx.canvas.width, ctx.canvas.height);
  const ux = ((end.x - start.x) / length) * reach;
  const uy = ((end.y - start.y) / length) * reach;
  ctx.save();
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(start.x - ux, start.y - uy);
  ctx.lineTo(start.x + ux, start.y + uy);
  ctx.stroke();
  ctx.restore();
}

function screen(point: Vec2, view: ViewTransform): Vec2 {
  return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
}
