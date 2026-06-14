// draw-pen-preview — render the pen tool's in-progress polyline (ADR-051 B6):
// solid segments between placed vertices, a dashed rubber-band to the cursor,
// and a small square at each vertex (the selection visual vocabulary). Scene-mm
// -> px via the ViewTransform, like every other draw-scene helper.

import { canvasTheme } from '../theme/canvas-theme';
import { type PenDraft } from '../state/ui-store';
import { type Vec2 } from '../../core/scene';
import { type ViewTransform } from './view-transform';

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
  strokePlacedSegments(ctx, penDraft.vertices, view);
  strokeRubberBand(ctx, penDraft.vertices, penDraft.cursor, view);
  fillVertexMarkers(ctx, penDraft.vertices, view);
  ctx.restore();
}

function strokePlacedSegments(
  ctx: CanvasRenderingContext2D,
  vertices: ReadonlyArray<Vec2>,
  view: ViewTransform,
): void {
  ctx.beginPath();
  vertices.forEach((v, i) => {
    const x = view.offsetX + v.x * view.scale;
    const y = view.offsetY + v.y * view.scale;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
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
