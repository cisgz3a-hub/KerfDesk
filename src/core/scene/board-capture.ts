// board-capture — pure geometry for the Capture Board Corners feature (ADR-124).
// The operator button-jogs the laser head to each corner of a physical board and
// records the machine coordinate at each one; these helpers turn those four
// captured points into a clean axis-aligned rectangle (for the on-canvas outline)
// and expose each corner + the centre as a machine coordinate (for "jog head to"
// targets). Pure — no DOM, no clock, no I/O, no exceptions for control flow.
//
// Order independence (ADR-124 amendment): the outline is derived from the
// axis-aligned BOUNDING BOX of the four points, so the operator can capture the
// corners in any direction (up the left side first, across the bottom first, …)
// and still get the right width, height, and orientation. Only the *first*
// corner is special — it sets the work origin, so it must be the bottom-left.

import type { Vec2 } from './scene-object';

// The five reference points on a captured board, shared by the on-canvas
// alignment buttons (align artwork to this corner/centre of the outline) and the
// jog-to-point buttons (move the head to this corner/centre of the board).
export type BoardAnchor = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const BOARD_CORNER_COUNT = 4;

export type BestFitRectangle = {
  // Machine-X and machine-Y extents of the captured corners — the board's size
  // and orientation as it sits on the bed. Order-independent.
  readonly widthMm: number;
  readonly heightMm: number;
  // How far the capture deviates from a clean rectangle square to the bed, in
  // mm: the largest distance from any bounding-box corner to the nearest
  // captured point. ~0 for a board square to the bed; it grows when the board is
  // rotated, a corner is mis-captured, or — critically — a corner is skipped and
  // another repeated (that leaves a box corner with no captured point near it).
  // Measured box-corner → nearest-point, NOT point → nearest-corner: the latter
  // scores a duplicated capture as 0 because every point still sits on some
  // corner, silently passing a board that never visited all four corners.
  readonly offSquareMm: number;
};

type Aabb = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

/**
 * Best-fit axis-aligned rectangle for four captured corner points (machine mm).
 * Width/height are the bounding-box extents, so the result is independent of the
 * order/direction the corners were captured in and preserves the board's real
 * orientation. Returns null unless exactly four points are supplied.
 */
export function bestFitRectangleFromCorners(corners: ReadonlyArray<Vec2>): BestFitRectangle | null {
  if (corners.length !== BOARD_CORNER_COUNT || !allFinite(corners)) return null;
  const box = boundingBox(corners);
  return {
    widthMm: box.maxX - box.minX,
    heightMm: box.maxY - box.minY,
    offSquareMm: maxBoxCornerGapMm(corners, box),
  };
}

/**
 * Map each {@link BoardAnchor} to a machine coordinate for the "jog head to"
 * targets: the four bounding-box corners and their centre. Order-independent,
 * so it stays correct however the corners were captured. Returns null unless
 * exactly four points are supplied.
 */
export function boardMachinePoints(
  corners: ReadonlyArray<Vec2>,
): Readonly<Record<BoardAnchor, Vec2>> | null {
  if (corners.length !== BOARD_CORNER_COUNT || !allFinite(corners)) return null;
  const box = boundingBox(corners);
  return {
    'bottom-left': { x: box.minX, y: box.minY },
    'bottom-right': { x: box.maxX, y: box.minY },
    'top-right': { x: box.maxX, y: box.maxY },
    'top-left': { x: box.minX, y: box.maxY },
    center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
  };
}

function allFinite(points: ReadonlyArray<Vec2>): boolean {
  return points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

function boundingBox(points: ReadonlyArray<Vec2>): Aabb {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

// The four corners of a clean axis-aligned board each have a captured point
// sitting on them. Measure every BOX corner to its nearest captured point (not
// the reverse): a capture that skips a corner and repeats another leaves one box
// corner with no point near it — a large gap — whereas point→nearest-corner
// would score that same bad capture 0 (every point still sits on some corner).
function maxBoxCornerGapMm(points: ReadonlyArray<Vec2>, box: Aabb): number {
  const boxCorners: ReadonlyArray<Vec2> = [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
  let worst = 0;
  for (const c of boxCorners) {
    let nearest = Number.POSITIVE_INFINITY;
    for (const p of points) nearest = Math.min(nearest, Math.hypot(p.x - c.x, p.y - c.y));
    worst = Math.max(worst, nearest);
  }
  return worst;
}
