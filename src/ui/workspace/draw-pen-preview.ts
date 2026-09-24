// draw-pen-preview — the pen tool's live overlay (ADR-051 B6, ADR-380): the
// placed path with its real curves, a dashed segment to where the next press
// would land (already bent by any smooth node), node markers (square = corner,
// round = smooth), the handles of dragged nodes, and the glyph of whatever the
// pointer snapped to. Scene-mm -> px via the ViewTransform, like every other
// draw-scene helper.

import type { CurveSubpath, Vec2 } from '../../core/scene';
import { penNodesToCurve, type PenNode } from '../../core/shapes/pen-path';
import { paintSnapGlyph } from '../design-studio/design-snap-marker-draw';
import { canvasTheme } from '../theme/canvas-theme';
import { penNodeForMode, type PenDraft, type PenHover, type PenNodeMode } from './pen-draft';
import type { ViewTransform } from './view-transform';

export type PenOverlay = {
  readonly draft: PenDraft | null;
  readonly hover: PenHover | null;
  readonly mode: PenNodeMode;
};

const NODE_HALF_PX = 3;
const HANDLE_DOT_PX = 2.5;
const TARGET_RING_PX = 8;
const GRID_MARK_PX = 5;
// The smooth-mode badge sits off the pointer's lower right, where a cursor
// badge usually sits, so it never hides the point being placed.
const MODE_BADGE_OFFSET_PX = 10;

export function drawPenOverlay(
  ctx: CanvasRenderingContext2D,
  overlay: PenOverlay,
  view: ViewTransform,
): void {
  ctx.save();
  ctx.lineWidth = 1.5;
  if (overlay.draft !== null && overlay.draft.nodes.length > 0) {
    drawDraftPath(ctx, overlay, overlay.draft, view);
    drawHandles(ctx, overlay.draft.nodes, view);
    drawNodes(ctx, overlay.draft.nodes, view);
  }
  if (overlay.hover !== null) drawHover(ctx, overlay.hover, overlay.mode, view);
  ctx.restore();
}

function drawDraftPath(
  ctx: CanvasRenderingContext2D,
  overlay: PenOverlay,
  draft: PenDraft,
  view: ViewTransform,
): void {
  const curve = previewCurve(draft, overlay.hover, overlay.mode);
  if (curve === null) return;
  const placed = draft.nodes.length - 1;
  ctx.strokeStyle = canvasTheme.selection;
  strokeSegments(ctx, curve, 0, placed, view);
  ctx.setLineDash([4, 3]);
  strokeSegments(ctx, curve, placed, curve.segments.length, view);
  ctx.setLineDash([]);
}

// The path as it would be if the operator pressed now: closing back to the
// first node, or with one more node at the hover point in the current mode.
function previewCurve(
  draft: PenDraft,
  hover: PenHover | null,
  mode: PenNodeMode,
): CurveSubpath | null {
  if (hover === null) return penNodesToCurve(draft.nodes, false);
  if (hover.intent === 'close' && draft.continues === undefined) {
    return penNodesToCurve(draft.nodes, true);
  }
  const next = penNodeForMode(hover.point, hover.intent === 'place' ? mode : 'corner');
  return penNodesToCurve([...draft.nodes, next], false);
}

function strokeSegments(
  ctx: CanvasRenderingContext2D,
  curve: CurveSubpath,
  from: number,
  to: number,
  view: ViewTransform,
): void {
  if (to <= from) return;
  const start = from === 0 ? curve.start : (curve.segments[from - 1]?.to ?? curve.start);
  ctx.beginPath();
  moveTo(ctx, start, view);
  for (const segment of curve.segments.slice(from, to)) {
    if (segment.kind === 'cubic') {
      const c1 = toPx(segment.control1, view);
      const c2 = toPx(segment.control2, view);
      const end = toPx(segment.to, view);
      ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    } else {
      lineTo(ctx, segment.to, view);
    }
  }
  ctx.stroke();
}

function drawHandles(
  ctx: CanvasRenderingContext2D,
  nodes: ReadonlyArray<PenNode>,
  view: ViewTransform,
): void {
  ctx.strokeStyle = canvasTheme.pathNodeHandleStroke;
  ctx.fillStyle = canvasTheme.pathNodeHandleStroke;
  ctx.lineWidth = 1;
  for (const node of nodes) {
    if (node.kind !== 'smooth') continue;
    const out = toPx(node.handleOut, view);
    const at = toPx(node.point, view);
    const back = { x: 2 * at.x - out.x, y: 2 * at.y - out.y };
    ctx.beginPath();
    ctx.moveTo(back.x, back.y);
    ctx.lineTo(out.x, out.y);
    ctx.stroke();
    for (const dot of [back, out]) {
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, HANDLE_DOT_PX, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawNodes(
  ctx: CanvasRenderingContext2D,
  nodes: ReadonlyArray<PenNode>,
  view: ViewTransform,
): void {
  ctx.fillStyle = canvasTheme.selectionHandleFill;
  ctx.strokeStyle = canvasTheme.selection;
  ctx.lineWidth = 1;
  for (const node of nodes) nodeMarker(ctx, toPx(node.point, view), node.kind === 'corner');
}

function nodeMarker(ctx: CanvasRenderingContext2D, at: Vec2, square: boolean): void {
  ctx.beginPath();
  if (square)
    ctx.rect(at.x - NODE_HALF_PX, at.y - NODE_HALF_PX, NODE_HALF_PX * 2, NODE_HALF_PX * 2);
  else ctx.arc(at.x, at.y, NODE_HALF_PX + 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

function drawHover(
  ctx: CanvasRenderingContext2D,
  hover: PenHover,
  mode: PenNodeMode,
  view: ViewTransform,
): void {
  const at = toPx(hover.point, view);
  if (hover.intent !== 'place') {
    // A ring marks a press that closes, continues or joins a path.
    ctx.strokeStyle = canvasTheme.selection;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(at.x, at.y, TARGET_RING_PX, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (hover.snap === 'grid') drawGridMark(ctx, at);
  else if (hover.snap !== null) paintSnapGlyph(ctx, at, hover.snap);
  if (mode === 'smooth') {
    ctx.fillStyle = canvasTheme.selectionHandleFill;
    ctx.strokeStyle = canvasTheme.selection;
    ctx.lineWidth = 1;
    nodeMarker(ctx, { x: at.x + MODE_BADGE_OFFSET_PX, y: at.y + MODE_BADGE_OFFSET_PX }, false);
  }
}

function drawGridMark(ctx: CanvasRenderingContext2D, at: Vec2): void {
  ctx.strokeStyle = canvasTheme.snapGuide;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(at.x - GRID_MARK_PX, at.y);
  ctx.lineTo(at.x + GRID_MARK_PX, at.y);
  ctx.moveTo(at.x, at.y - GRID_MARK_PX);
  ctx.lineTo(at.x, at.y + GRID_MARK_PX);
  ctx.stroke();
}

function toPx(point: Vec2, view: ViewTransform): Vec2 {
  return { x: view.offsetX + point.x * view.scale, y: view.offsetY + point.y * view.scale };
}

function moveTo(ctx: CanvasRenderingContext2D, point: Vec2, view: ViewTransform): void {
  const at = toPx(point, view);
  ctx.moveTo(at.x, at.y);
}

function lineTo(ctx: CanvasRenderingContext2D, point: Vec2, view: ViewTransform): void {
  const at = toPx(point, view);
  ctx.lineTo(at.x, at.y);
}
