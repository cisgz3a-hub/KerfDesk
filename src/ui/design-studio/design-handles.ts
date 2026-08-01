// design-handles — the resize grips around a selection (ADR-272, DS-8d, edge
// grips added by Amendment 4).
//
// PURE: bounds in, handle positions out, plus which grip a millimetre point
// picks. Kept out of both painters so the 2D canvas and the 3D viewport grow
// the same grips from the same maths, and so the geometry tests without a DOM.
//
// Eight grips: four corners scale uniformly, four edges stretch ONE axis and
// hold the other. Corner and edge answer the same question — "how much bigger,
// measured from the opposite side" — so they share one handle shape and differ
// only in which axes the drag is allowed to move.

import { entityBounds, type Sketch } from '../../core/design';
import type { StretchFactors } from '../../core/design/ops';
import type { Bounds, Vec2 } from '../../core/scene';

/** The box around the selected entities, or null when nothing is selected. */
export function selectionBounds(sketch: Sketch, ids: ReadonlySet<string>): Bounds | null {
  if (ids.size === 0) return null;
  let box: Bounds | null = null;
  for (const entity of sketch.entities) {
    if (!ids.has(entity.id)) continue;
    const bounds = entityBounds(entity);
    box =
      box === null
        ? bounds
        : {
            minX: Math.min(box.minX, bounds.minX),
            minY: Math.min(box.minY, bounds.minY),
            maxX: Math.max(box.maxX, bounds.maxX),
            maxY: Math.max(box.maxY, bounds.maxY),
          };
  }
  return box;
}

export const RESIZE_HANDLE_CORNERS = ['sw', 'se', 'nw', 'ne'] as const;
export type ResizeHandleCorner = (typeof RESIZE_HANDLE_CORNERS)[number];

export const RESIZE_HANDLE_EDGES = ['w', 'e', 's', 'n'] as const;
export type ResizeHandleEdge = (typeof RESIZE_HANDLE_EDGES)[number];

export type ResizeHandleId = ResizeHandleCorner | ResizeHandleEdge;

// Which axes a drag on this grip is allowed to change. 'both' is the uniform
// corner scale; 'x' and 'y' are the single-axis edge stretches.
export type ResizeHandleAxis = 'both' | 'x' | 'y';

// Grip size and grab radius in SCREEN pixels: a grip is a property of the hand
// and the screen, so it keeps its size at any zoom or camera tilt.
export const RESIZE_HANDLE_SIZE_PX = 9;
export const RESIZE_HANDLE_GRAB_PX = 11;

export type ResizeHandle = {
  readonly id: ResizeHandleId;
  readonly axis: ResizeHandleAxis;
  readonly atMm: Vec2;
  // The point a drag on this grip holds still: the opposite corner for a corner
  // grip, the midpoint of the opposite edge for an edge grip.
  readonly anchorMm: Vec2;
};

/**
 * The grips for a selection's bounds: four corners plus the four edge
 * midpoints. Returns none when the bounds have no extent on either axis, since
 * every factor would then be undefined.
 *
 * An edge grip is omitted when ITS axis has no extent — stretching the height
 * of a horizontal line is a division by zero, not a resize — while the corner
 * grips stay, because a diagonal span survives one flat axis.
 */
export function resizeHandles(bounds: Bounds | null): ReadonlyArray<ResizeHandle> {
  if (bounds === null) return [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) && !(height > 0)) return [];
  const corners = RESIZE_HANDLE_CORNERS.map((id) => ({
    id,
    axis: 'both' as const,
    atMm: cornerPoint(bounds, id),
    anchorMm: cornerPoint(bounds, oppositeCorner(id)),
  }));
  const edges = RESIZE_HANDLE_EDGES.filter((id) =>
    edgeAxis(id) === 'x' ? width > 0 : height > 0,
  ).map((id) => ({
    id,
    axis: edgeAxis(id),
    atMm: edgePoint(bounds, id),
    anchorMm: edgePoint(bounds, oppositeEdge(id)),
  }));
  return [...corners, ...edges];
}

/** The grip within `toleranceMm` of the point, nearest first, or null. */
export function handleAtPoint(
  handles: ReadonlyArray<ResizeHandle>,
  pointMm: Vec2,
  toleranceMm: number,
): ResizeHandle | null {
  let best: { handle: ResizeHandle; distanceMm: number } | null = null;
  for (const handle of handles) {
    const distanceMm = Math.hypot(handle.atMm.x - pointMm.x, handle.atMm.y - pointMm.y);
    if (distanceMm > toleranceMm) continue;
    if (best === null || distanceMm < best.distanceMm) best = { handle, distanceMm };
  }
  return best?.handle ?? null;
}

/**
 * The per-axis factors a drag to `pointMm` asks for, measured from the held
 * anchor.
 *
 * A corner grip answers with the same factor on both axes — the change in
 * straight-line distance, so the selection scales uniformly. An edge grip
 * answers with the span change along its own axis and exactly 1 on the other,
 * so the held dimension is untouched by rounding as well as by intent.
 *
 * Both return 1 where there is no span to measure against.
 */
export function resizeFactors(handle: ResizeHandle, pointMm: Vec2): StretchFactors {
  if (handle.axis === 'both') {
    const uniform = uniformFactor(handle, pointMm);
    return { x: uniform, y: uniform };
  }
  const along = axisFactor(handle, pointMm, handle.axis);
  return handle.axis === 'x' ? { x: along, y: 1 } : { x: 1, y: along };
}

function uniformFactor(handle: ResizeHandle, pointMm: Vec2): number {
  const startSpan = Math.hypot(
    handle.atMm.x - handle.anchorMm.x,
    handle.atMm.y - handle.anchorMm.y,
  );
  if (!(startSpan > 0)) return 1;
  const dragSpan = Math.hypot(pointMm.x - handle.anchorMm.x, pointMm.y - handle.anchorMm.y);
  return dragSpan / startSpan;
}

function axisFactor(handle: ResizeHandle, pointMm: Vec2, axis: 'x' | 'y'): number {
  const startSpan = handle.atMm[axis] - handle.anchorMm[axis];
  if (startSpan === 0) return 1;
  return (pointMm[axis] - handle.anchorMm[axis]) / startSpan;
}

function cornerPoint(bounds: Bounds, corner: ResizeHandleCorner): Vec2 {
  const x = corner === 'sw' || corner === 'nw' ? bounds.minX : bounds.maxX;
  const y = corner === 'sw' || corner === 'se' ? bounds.minY : bounds.maxY;
  return { x, y };
}

// The midpoint of the named edge: the grip sits halfway along the side it
// moves, which is where the hand expects a stretch handle.
function edgePoint(bounds: Bounds, edge: ResizeHandleEdge): Vec2 {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  switch (edge) {
    case 'w':
      return { x: bounds.minX, y: midY };
    case 'e':
      return { x: bounds.maxX, y: midY };
    case 's':
      return { x: midX, y: bounds.minY };
    case 'n':
      return { x: midX, y: bounds.maxY };
  }
}

function edgeAxis(edge: ResizeHandleEdge): 'x' | 'y' {
  return edge === 'w' || edge === 'e' ? 'x' : 'y';
}

function oppositeEdge(edge: ResizeHandleEdge): ResizeHandleEdge {
  switch (edge) {
    case 'w':
      return 'e';
    case 'e':
      return 'w';
    case 's':
      return 'n';
    case 'n':
      return 's';
  }
}

function oppositeCorner(corner: ResizeHandleCorner): ResizeHandleCorner {
  switch (corner) {
    case 'sw':
      return 'ne';
    case 'se':
      return 'nw';
    case 'nw':
      return 'se';
    case 'ne':
      return 'sw';
  }
}
