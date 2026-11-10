// design-tracking — what the live gesture tracks FROM and what it lines up WITH
// (ADR-272 Amendment 6, Phase N DS-4b).
//
// The pure engine in core/design/snap needs two things the session knows: the
// point the gesture started from (for polar rays and for tangent and
// perpendicular snaps) and the reference points alignment guides may use. A
// moving selection tracks differently: its BOX lines up with other objects'
// boxes, so a part can be dragged level with its neighbour without hunting for
// a corner to grab.

import { entityBounds } from '../../core/design/sketch-bounds';
import { entitySnapPoints } from '../../core/design/snap';
import { alignBounds, type TrackingLine } from '../../core/design/snap/tracking';
import type { Bounds, Vec2 } from '../../core/scene';
import { selectionBounds } from './design-handles';
import type { DesignSession } from './design-session';

export type DesignTracking = {
  readonly guides: ReadonlyArray<TrackingLine>;
  // The polar angle the pointer was tracked to, when a polar ray caught it.
  readonly polarDeg: number | null;
};

export const DEFAULT_POLAR_STEP_DEG = 15;
export const POLAR_STEP_CHOICES_DEG: ReadonlyArray<number> = [5, 10, 15, 30, 45, 90];
// Tracking reach in screen pixels. Smaller than the object-snap reach: a guide
// only says "this lines up", so it should take hold only when the operator is
// clearly reaching for the line.
export const TRACKING_RADIUS_PX = 6;

/**
 * Where the live gesture started: a drag's anchor, a polyline's last corner, or
 * an arc's centre while its start is placed. Null when nothing is being drawn
 * (or an arc is sweeping its end, which is pinned to the radius anyway).
 */
export function gestureAnchorMm(session: DesignSession): Vec2 | null {
  if (session.draft !== null) return session.draft.anchorMm;
  const sequence = session.pointSequence;
  if (sequence === null) return null;
  if (sequence.kind === 'path') return sequence.points[sequence.points.length - 1] ?? null;
  return sequence.startMm === null ? sequence.centerMm : null;
}

/**
 * The points alignment guides may line up with: every named point of the
 * drawing (corners, midpoints, centres, quadrants) plus the corners already
 * placed in the live gesture, so a polyline can be closed square.
 */
export function trackingReferences(session: DesignSession): ReadonlyArray<Vec2> {
  const moving = session.move?.ids;
  const named = session.history.present.entities
    .filter((entity) => moving?.has(entity.id) !== true)
    .flatMap((entity) => entitySnapPoints(entity).map((target) => target.atMm));
  const sequence = session.pointSequence;
  const placed =
    sequence === null
      ? []
      : sequence.kind === 'path'
        ? sequence.points
        : [sequence.centerMm, ...(sequence.startMm === null ? [] : [sequence.startMm])];
  const anchor = session.draft === null ? [] : [session.draft.anchorMm];
  return [...named, ...placed, ...anchor];
}

/**
 * During a move, the pointer adjusted so the selection's box lines up with
 * another object's left / centre / right or bottom / middle / top, with the
 * guides that say so. Null when nothing lines up.
 */
export function alignMovePointer(
  session: DesignSession,
  pointerMm: Vec2,
  toleranceMm: number,
): { readonly pointMm: Vec2; readonly tracking: DesignTracking } | null {
  const move = session.move;
  if (move === null) return null;
  const sketch = session.history.present;
  const current = selectionBounds(sketch, move.ids);
  if (current === null) return null;
  const step = { x: pointerMm.x - move.lastMm.x, y: pointerMm.y - move.lastMm.y };
  const references: Bounds[] = sketch.entities
    .filter((entity) => !move.ids.has(entity.id))
    .map((entity) => entityBounds(entity));
  const aligned = alignBounds(shifted(current, step), references, toleranceMm);
  if (aligned === null) return null;
  return {
    pointMm: { x: pointerMm.x + aligned.deltaMm.x, y: pointerMm.y + aligned.deltaMm.y },
    tracking: { guides: aligned.guides, polarDeg: null },
  };
}

function shifted(bounds: Bounds, by: Vec2): Bounds {
  return {
    minX: bounds.minX + by.x,
    minY: bounds.minY + by.y,
    maxX: bounds.maxX + by.x,
    maxY: bounds.maxY + by.y,
  };
}
