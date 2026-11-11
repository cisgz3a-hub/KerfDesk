// Small 2D point helpers shared by core, io and ui.
//
// Each of these was written out again in ten to twenty files (code quality
// audit C1, C2-P3-1). Every copy replaced by an import had this body, so no
// result changes. The one exception is `distance`: some copies subtracted the
// other way round, which gives the same value because `Math.hypot` ignores sign. The file imports nothing, so it cannot join an import cycle.
//
// Helpers that compare with a tolerance are NOT here on purpose: the copies use
// different tolerances, and choosing one would move toolpaths.

type Vec2 = { readonly x: number; readonly y: number };

/** Straight-line distance between two points. */
export function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** True when both coordinates are exactly equal. No tolerance. */
export function samePoint(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.y === b.y;
}

/** True when neither coordinate is NaN or infinite. */
export function isFinitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/** The point a fraction `t` of the way from `a` to `b` (0 gives `a`, 1 gives `b`). */
export function lerpPoint(a: Vec2, b: Vec2, t: number): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** The point halfway between two points. */
export function midpoint(a: Vec2, b: Vec2): { x: number; y: number } {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** `a + b`, coordinate by coordinate. */
export function addPoints(a: Vec2, b: Vec2): { x: number; y: number } {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** `a - b`, coordinate by coordinate. */
export function subtractPoints(a: Vec2, b: Vec2): { x: number; y: number } {
  return { x: a.x - b.x, y: a.y - b.y };
}

/** Dot product of two vectors. */
export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Cross product of `origin→a` and `origin→b`: twice the signed area of the
 * triangle. Positive when `b` lies counter-clockwise of `a` in a Y-up frame.
 */
export function crossAbout(origin: Vec2, a: Vec2, b: Vec2): number {
  return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
}

/** Summed length of the segments of an open polyline. */
export function polylineLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1] as Vec2;
    const b = points[index] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/** The vector turned to point the other way. */
export function negatePoint(point: Vec2): { x: number; y: number } {
  return { x: -point.x, y: -point.y };
}

/** The vector with both coordinates multiplied by `factor`. */
export function scalePoint(point: Vec2, factor: number): { x: number; y: number } {
  return { x: point.x * factor, y: point.y * factor };
}

/** Cross product of two vectors: positive when `b` is counter-clockwise of `a` (Y up). */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

/** Length of a vector. */
export function vectorLength(vector: Vec2): number {
  return Math.hypot(vector.x, vector.y);
}
