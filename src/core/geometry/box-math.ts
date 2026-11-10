// Axis-aligned box helpers shared by core, io and ui.
//
// Each of these was written out again in three to six files (code quality
// audit C1, C2-P3-1). Every copy replaced by an import had this exact body, so
// no result changes. The file imports nothing, so it cannot join an import cycle.

type Vec2 = { readonly x: number; readonly y: number };
type Box = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};
type MutableBox = { minX: number; minY: number; maxX: number; maxY: number };
type Corner = { x: number; y: number };

/**
 * The smallest box holding every point. With no points the box is inverted
 * (min is +Infinity, max is -Infinity), so callers must check for that.
 */
export function boundsOfPoints(points: Iterable<Vec2>): MutableBox {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

/** The box whose opposite corners are the two points, in either order. */
export function segmentBox(a: Vec2, b: Vec2): MutableBox {
  return {
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
  };
}

/** True when `inner` lies inside `outer`; touching edges count as inside. */
export function boxContains(outer: Box, inner: Box): boolean {
  return (
    outer.minX <= inner.minX &&
    outer.minY <= inner.minY &&
    outer.maxX >= inner.maxX &&
    outer.maxY >= inner.maxY
  );
}

/** The smallest box holding both boxes. */
export function unionBox(a: Box, b: Box): MutableBox {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/** True when the boxes share any point; touching edges count as overlapping. */
export function boxesOverlap(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/** True when the point lies inside the box; the edges count as inside. */
export function pointInBox(point: Vec2, box: Box): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

/** True when none of the four limits is NaN or infinite. */
export function isFiniteBox(box: Box): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY)
  );
}

/** The four corners, starting at (minX, minY) and going round by X first. */
export function boxCorners(box: Box): [Corner, Corner, Corner, Corner] {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

/** The box moved outwards by `margin` on every side. */
export function growBox(box: Box, margin: number): MutableBox {
  return {
    minX: box.minX - margin,
    minY: box.minY - margin,
    maxX: box.maxX + margin,
    maxY: box.maxY + margin,
  };
}

/** The point at the middle of the box. */
export function boxCentre(box: Box): { x: number; y: number } {
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}
