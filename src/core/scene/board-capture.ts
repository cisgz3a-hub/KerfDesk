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

// The shape of a captured board (ADR-126). A rectangle comes from the four-corner
// (or one-corner + typed size) capture; a circle comes from a single centre
// capture plus a diameter (typed, or measured by jogging to a rim point).
// Extensible — future variants (rounded-rect, polygon) add a `kind` arm wherever
// it is matched (each ending in assertNever), gated by an ADR.
export type BoardShape =
  | { readonly kind: 'rect'; readonly widthMm: number; readonly heightMm: number }
  | { readonly kind: 'circle'; readonly diameterMm: number };

export type BoardShapeKind = BoardShape['kind'];

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
 * Distance (mm) from the FIRST captured corner to the bounding-box bottom-left
 * (minX, minY). Board geometry is order-independent, but the G92 work origin is
 * set at the first corner captured — capturing e.g. the top-right first draws a
 * correct-looking outline while the origin (and the burn) sits at the wrong
 * corner. This flags that without needing the device origin: the feature's
 * convention is machine +X = width, +Y = height, so bottom-left ≡ (minX, minY).
 * Returns null unless exactly four finite corners (the manual-size path
 * synthesizes the first corner AT the origin, so its offset is 0 — no warning).
 */
export function firstCornerOffsetMm(corners: ReadonlyArray<Vec2>): number | null {
  if (corners.length !== BOARD_CORNER_COUNT || !allFinite(corners)) return null;
  const first = corners[0];
  if (first === undefined) return null;
  const box = boundingBox(corners);
  return Math.hypot(first.x - box.minX, first.y - box.minY);
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

/**
 * The four corners of an axis-aligned width × height board whose bottom-left
 * corner sits at `origin` (machine mm): BL, BR, TR, TL. Used by the manual-size
 * path — the operator captures only the bottom-left corner (which sets the work
 * origin), types the size, and this synthesizes the other three so the rest of
 * the flow (outline, jog-to-corner) behaves exactly like a four-corner capture.
 * Assumes machine +X spans the board's width and +Y its height (the front-left
 * origin the feature is built around).
 */
export function boardCornersFromOrigin(
  origin: Vec2,
  widthMm: number,
  heightMm: number,
): ReadonlyArray<Vec2> {
  return [
    origin,
    { x: origin.x + widthMm, y: origin.y },
    { x: origin.x + widthMm, y: origin.y + heightMm },
    { x: origin.x, y: origin.y + heightMm },
  ];
}

/**
 * The diameter of a circular board from its captured centre and any point on the
 * rim: 2·|edge − centre| (machine mm). The operator jogs to the centre (which
 * sets the work origin), then to any edge, measuring the size without a ruler.
 * Returns 0 for non-finite inputs (no throw); callers clamp to a minimum size.
 */
export function diameterFromCenterEdge(center: Vec2, edge: Vec2): number {
  if (!isFiniteVec(center) || !isFiniteVec(edge)) return 0;
  return 2 * Math.hypot(edge.x - center.x, edge.y - center.y);
}

function allFinite(points: ReadonlyArray<Vec2>): boolean {
  return points.every(isFiniteVec);
}

function isFiniteVec(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
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
