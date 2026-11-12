// Which resize handles a selection box offers at its size on the screen, and
// which presses near them belong to the artwork instead (ADR-196 Amendment 1).
//
// Handles are 8 px squares centred on the box's corners and sides, and they
// are tested before the artwork. On a small box they met and covered it, so a
// drag meant to move a small part resized it; on a straight line the top and
// bottom handles sat on the move handle and did nothing at all.
//
// Shared by a single object's box (its own turned frame, handles.ts) and a
// multi-selection's upright box (selection-handles.ts).

import type { Vec2 } from '../../core/scene';
import type { HandleKind } from './handles';

export const HANDLE_SCREEN_PX = 8;
// A side needs three handle widths to hold a middle handle clear of its corners.
const SIDE_FOR_MIDDLE_HANDLE_PX = HANDLE_SCREEN_PX * 3;
// A box with no extent along an axis, in millimetres (the group resize's own limit).
const FLAT_EXTENT_MM = 0.000001;

/** A selection box measured along its own two axes. */
export type HandleBox = {
  readonly widthMm: number;
  readonly heightMm: number;
};

const CORNERS: ReadonlyArray<HandleKind> = ['nw', 'ne', 'se', 'sw'];

/**
 * The handles the box shows and answers to.
 *
 * - A straight line along one of its axes keeps the two handles at its ends:
 *   the others either coincide with them or pull along an axis it does not have.
 * - A side shorter than 24 px has no middle handle, which would touch the corners.
 * - A middle handle also goes when the box is under 8 px across the other way,
 *   where it would cover its twin on the far side and the move handle between them.
 */
export function offeredHandleKinds(box: HandleBox, pxToMm: number): ReadonlyArray<HandleKind> {
  const flatWidth = box.widthMm <= FLAT_EXTENT_MM;
  const flatHeight = box.heightMm <= FLAT_EXTENT_MM;
  if (flatWidth && flatHeight) return [];
  if (flatHeight) return ['e', 'w'];
  if (flatWidth) return ['n', 's'];
  const widthPx = box.widthMm / pxToMm;
  const heightPx = box.heightMm / pxToMm;
  const kinds = [...CORNERS];
  if (widthPx >= SIDE_FOR_MIDDLE_HANDLE_PX && heightPx >= HANDLE_SCREEN_PX) kinds.push('n', 's');
  if (heightPx >= SIDE_FOR_MIDDLE_HANDLE_PX && widthPx >= HANDLE_SCREEN_PX) kinds.push('e', 'w');
  return kinds;
}

/**
 * Whether a press at `local` (millimetres along the box's axes from its first
 * corner) is left to the artwork. On a box under 24 px on its shorter side a
 * press strictly inside the box never takes a handle, so each handle answers only on
 * the part of its square that lies outside. A straight line has no inside
 * and is measured by its length: when that is under 24 px, the band a
 * handle's half-width either side of it, between its ends, counts.
 */
export function pressBelongsToBody(box: HandleBox, local: Vec2, pxToMm: number): boolean {
  if (shortestSideMm(box) / pxToMm >= SIDE_FOR_MIDDLE_HANDLE_PX) return false;
  const halfHandleMm = (HANDLE_SCREEN_PX / 2) * pxToMm;
  return (
    withinSide(local.x, box.widthMm, halfHandleMm) &&
    withinSide(local.y, box.heightMm, halfHandleMm)
  );
}

// The shorter of the sides the box has; a straight line has only its length.
function shortestSideMm(box: HandleBox): number {
  if (box.widthMm <= FLAT_EXTENT_MM) return box.heightMm;
  if (box.heightMm <= FLAT_EXTENT_MM) return box.widthMm;
  return Math.min(box.widthMm, box.heightMm);
}

function withinSide(at: number, extentMm: number, halfHandleMm: number): boolean {
  if (extentMm <= FLAT_EXTENT_MM) return Math.abs(at) <= halfHandleMm;
  // The corner points and the edges themselves stay with the handles.
  return at > 0 && at < extentMm;
}

/** The handle under the point: the nearest of those whose 8 px square holds it. */
export function nearestHandleAt<Handle extends { readonly position: Vec2 }>(
  handles: ReadonlyArray<Handle>,
  point: Vec2,
  pxToMm: number,
): Handle | null {
  const halfMm = (HANDLE_SCREEN_PX / 2) * pxToMm;
  let nearest: Handle | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const handle of handles) {
    const dx = Math.abs(point.x - handle.position.x);
    const dy = Math.abs(point.y - handle.position.y);
    if (dx > halfMm || dy > halfMm) continue;
    const distance = Math.hypot(dx, dy);
    if (distance < nearestDistance) {
      nearest = handle;
      nearestDistance = distance;
    }
  }
  return nearest;
}
