// draw-pen-preview — render the pen tool's in-progress polyline (ADR-051 B6):
// solid segments between placed vertices, a dashed rubber-band to the cursor,
// and a small square at each vertex (the selection visual vocabulary). Scene-mm
// -> px via the ViewTransform, like every other draw-scene helper.

import { canvasTheme } from '../theme/canvas-theme';
import { type PenDraft } from '../state/ui-store';
import { type Vec2 } from '../../core/scene';
import { type ViewTransform } from './view-transform';
import { penContour } from './pen-curve';

const VERTEX_HALF_PX = 3;

export function drawPenDraft(
  ctx: CanvasRenderingContext2D,
  penDraft: PenDraft,
  view: ViewTransform,
): void {
  if (penDraft.vertices.length === 0) return;
  ctx.save();
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1.5;
  strokePlacedSegments(ctx, penDraft, view);
  strokeRubberBand(ctx, penDraft.vertices, penDraft.cursor, view);
  strokeHandles(ctx, penDraft, view);
  fillVertexMarkers(ctx, penDraft.vertices, view);
  ctx.restore();
}

// The placed path as it will be drawn: straight between corner clicks, exact
// Bezier curves through dragged nodes.
function strokePlacedSegments(
  ctx: CanvasRenderingContext2D,
  penDraft: PenDraft,
  view: ViewTransform,
): void {
  const contour = penContour(penDraft.vertices, penDraft.handles ?? [], false);
  if (contour === null) return;
  const px = (point: Vec2) =>
    [view.offsetX + point.x * view.scale, view.offsetY + point.y * view.scale] as const;
  ctx.beginPath();
  ctx.moveTo(...px(contour.start));
  for (const segment of contour.segments) {
    if (segment.kind === 'cubic') {
      ctx.bezierCurveTo(...px(segment.control1), ...px(segment.control2), ...px(segment.to));
    } else {
      ctx.lineTo(...px(segment.to));
    }
  }
  ctx.stroke();
}

// A dragged node shows its handle line through the vertex, mirrored each way.
function strokeHandles(
  ctx: CanvasRenderingContext2D,
  penDraft: PenDraft,
  view: ViewTransform,
): void {
  ctx.lineWidth = 1;
  penDraft.vertices.forEach((vertex, index) => {
    const handle = penDraft.handles?.[index];
    if (handle === null || handle === undefined) return;
    const mirror = { x: 2 * vertex.x - handle.x, y: 2 * vertex.y - handle.y };
    ctx.beginPath();
    ctx.moveTo(view.offsetX + mirror.x * view.scale, view.offsetY + mirror.y * view.scale);
    ctx.lineTo(view.offsetX + handle.x * view.scale, view.offsetY + handle.y * view.scale);
    ctx.stroke();
  });
}

function strokeRubberBand(
  ctx: CanvasRenderingContext2D,
  vertices: ReadonlyArray<Vec2>,
  cursor: Vec2 | null,
  view: ViewTransform,
): void {
  const last = vertices[vertices.length - 1];
  if (cursor === null || last === undefined) return;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(view.offsetX + last.x * view.scale, view.offsetY + last.y * view.scale);
  ctx.lineTo(view.offsetX + cursor.x * view.scale, view.offsetY + cursor.y * view.scale);
  ctx.stroke();
  ctx.setLineDash([]);
}

function fillVertexMarkers(
  ctx: CanvasRenderingContext2D,
  vertices: ReadonlyArray<Vec2>,
  view: ViewTransform,
): void {
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  for (const v of vertices) {
    const x = view.offsetX + v.x * view.scale;
    const y = view.offsetY + v.y * view.scale;
    ctx.fillRect(x - VERTEX_HALF_PX, y - VERTEX_HALF_PX, VERTEX_HALF_PX * 2, VERTEX_HALF_PX * 2);
  }
}
