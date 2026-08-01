// design-handles — the resize grips around a selection (ADR-272, DS-8d).
//
// PURE: bounds in, handle positions out, plus which grip a millimetre point
// picks. Kept out of both painters so the 2D canvas and the 3D viewport grow
// the same grips from the same maths, and so the geometry tests without a DOM.
//
// Four corners only. The scale is uniform (see scaleEntities), so an edge grip
// would promise a stretch the entity model cannot hold.

import { entityBounds, type Sketch } from '../../core/design';
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

// Grip size and grab radius in SCREEN pixels: a grip is a property of the hand
// and the screen, so it keeps its size at any zoom or camera tilt.
export const RESIZE_HANDLE_SIZE_PX = 9;
export const RESIZE_HANDLE_GRAB_PX = 11;

export type ResizeHandle = {
  readonly corner: ResizeHandleCorner;
  readonly atMm: Vec2;
  // The corner diagonally opposite — the point a drag on this grip holds still.
  readonly anchorMm: Vec2;
};

/**
 * The four corner grips for a selection's bounds, or null when the bounds have
 * no extent (a single point, or nothing selected) and a scale factor would be
 * undefined.
 */
export function resizeHandles(bounds: Bounds | null): ReadonlyArray<ResizeHandle> {
  if (bounds === null) return [];
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0) && !(height > 0)) return [];
  const corner = (corner: ResizeHandleCorner): ResizeHandle => {
    const atMm = cornerPoint(bounds, corner);
    return { corner, atMm, anchorMm: cornerPoint(bounds, oppositeCorner(corner)) };
  };
  return RESIZE_HANDLE_CORNERS.map(corner);
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
 * The uniform factor a drag to `pointMm` asks for, measured as the change in
 * distance from the held anchor. Returns 1 when the grip started on top of its
 * anchor, since there is no span to scale.
 */
export function resizeFactor(handle: ResizeHandle, pointMm: Vec2): number {
  const startSpan = Math.hypot(
    handle.atMm.x - handle.anchorMm.x,
    handle.atMm.y - handle.anchorMm.y,
  );
  if (!(startSpan > 0)) return 1;
  const dragSpan = Math.hypot(pointMm.x - handle.anchorMm.x, pointMm.y - handle.anchorMm.y);
  return dragSpan / startSpan;
}

function cornerPoint(bounds: Bounds, corner: ResizeHandleCorner): Vec2 {
  const x = corner === 'sw' || corner === 'nw' ? bounds.minX : bounds.maxX;
  const y = corner === 'sw' || corner === 'se' ? bounds.minY : bounds.maxY;
  return { x, y };
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
