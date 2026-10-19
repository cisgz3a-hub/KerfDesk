// board-polygon — pure geometry for a custom-shape board (ADR-636). The operator
// jogs the head (or its positioning light) to each corner of an irregular board
// in turn; these helpers turn those machine points into a clean outline, its
// size, and the machine point the work origin belongs at: the physical
// front-left corner of the outline's bounding box, the same reference corner a
// rectangular board uses, so a job anchored front-left lands on the board.
// Pure — no DOM, no clock, no I/O.

import type { Vec2 } from './scene-object';

export const MIN_BOARD_POLYGON_POINTS = 3;
export const MAX_BOARD_POLYGON_POINTS = 64;
// Below this the "polygon" is a sliver: the points are effectively in a line.
const MIN_BOARD_POLYGON_AREA_MM2 = 1;

/** Machine-axis direction of "operator's right" (x) and "away from the operator" (y). */
export type BoardAxisSigns = { readonly x: 1 | -1; readonly y: 1 | -1 };

export type BoardPolygon = {
  /** Machine coordinates of every corner, in outline order. */
  readonly points: ReadonlyArray<Vec2>;
  /** Machine point of the physical front-left corner of the bounding box. */
  readonly origin: Vec2;
  /** Physical width (left→right) and depth (front→back) of the bounding box. */
  readonly widthMm: number;
  readonly heightMm: number;
  readonly areaMm2: number;
  /**
   * Canvas-space outline (Y down) relative to the bounding box's top-left, so
   * (0, heightMm) is the front-left corner the work origin is set at.
   */
  readonly outline: ReadonlyArray<Vec2>;
  /** True when the capture order crossed itself and the corners were re-sorted. */
  readonly reordered: boolean;
};

export type BoardPolygonIssue = 'too-few-points' | 'not-finite' | 'too-thin' | 'self-crossing';

export type BoardPolygonResult =
  | { readonly kind: 'ok'; readonly polygon: BoardPolygon }
  | { readonly kind: 'error'; readonly issue: BoardPolygonIssue };

/**
 * Build a board outline from corners captured in machine coordinates. The
 * operator normally walks around the edge, so the capture order is the outline
 * order; when that order crosses itself (a corner was skipped and captured
 * last), the corners are re-sorted around their centroid if that yields a
 * simple outline. `signs` maps machine axes to the operator's view so the
 * outline is never drawn mirrored on rear- or right-origin machines.
 */
export function boardPolygonFromPoints(
  points: ReadonlyArray<Vec2>,
  signs: BoardAxisSigns,
): BoardPolygonResult {
  if (points.length < MIN_BOARD_POLYGON_POINTS) return { kind: 'error', issue: 'too-few-points' };
  if (!points.every(isFiniteVec)) return { kind: 'error', issue: 'not-finite' };
  let ordered = points;
  let reordered = false;
  if (polygonSelfIntersects(points)) {
    const sorted = sortAroundCentroid(points);
    if (polygonSelfIntersects(sorted)) return { kind: 'error', issue: 'self-crossing' };
    ordered = sorted;
    reordered = true;
  }
  // Judged on the final order: a crossed capture's two lobes cancel in area.
  if (Math.abs(signedArea(ordered)) < MIN_BOARD_POLYGON_AREA_MM2) {
    return { kind: 'error', issue: 'too-thin' };
  }
  return { kind: 'ok', polygon: describePolygon(ordered, signs, reordered) };
}

/** The polygon after one corner moved to `point` (a physical check of that corner). */
export function boardPolygonWithPoint(
  polygon: BoardPolygon,
  index: number,
  point: Vec2,
  signs: BoardAxisSigns,
): BoardPolygon | null {
  if (index < 0 || index >= polygon.points.length || !isFiniteVec(point)) return null;
  const points = polygon.points.map((existing, i) => (i === index ? point : existing));
  if (Math.abs(signedArea(points)) < MIN_BOARD_POLYGON_AREA_MM2) return null;
  if (polygonSelfIntersects(points)) return null;
  return describePolygon(points, signs, false);
}

function describePolygon(
  points: ReadonlyArray<Vec2>,
  signs: BoardAxisSigns,
  reordered: boolean,
): BoardPolygon {
  // Physical frame: +x = operator's right, +y = away from the operator.
  const physical = points.map((p) => ({ x: signs.x * p.x, y: signs.y * p.y }));
  const minX = Math.min(...physical.map((p) => p.x));
  const maxX = Math.max(...physical.map((p) => p.x));
  const minY = Math.min(...physical.map((p) => p.y));
  const maxY = Math.max(...physical.map((p) => p.y));
  return {
    points,
    origin: { x: signs.x * minX, y: signs.y * minY },
    widthMm: maxX - minX,
    heightMm: maxY - minY,
    areaMm2: Math.abs(signedArea(points)),
    // Canvas Y grows toward the operator, so the back edge (maxY) is canvas 0.
    outline: physical.map((p) => ({ x: p.x - minX, y: maxY - p.y })),
    reordered,
  };
}

/** Shoelace area; the sign depends on winding, callers use the magnitude. */
export function signedArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    twice += a.x * b.y - b.x * a.y;
  }
  return twice / 2;
}

/** True when any two non-adjacent edges of the closed outline touch or cross. */
export function polygonSelfIntersects(points: ReadonlyArray<Vec2>): boolean {
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      // Adjacent edges share a vertex by construction; the first and last
      // edges are adjacent on a closed outline.
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = points[i];
      const b = points[(i + 1) % n];
      const c = points[j];
      const d = points[(j + 1) % n];
      if (a === undefined || b === undefined || c === undefined || d === undefined) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function sortAroundCentroid(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
  const first = points[0];
  const sorted = [...points].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
  );
  // Keep the first captured corner first so the outline reads in capture terms.
  const start = first === undefined ? 0 : sorted.indexOf(first);
  return [...sorted.slice(start), ...sorted.slice(0, start)];
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (straddles(d1, d2) && straddles(d3, d4)) return true;
  // Collinear touches: an endpoint lying on the other segment.
  return (
    touches(d1, c, d, a) || touches(d2, c, d, b) || touches(d3, a, b, c) || touches(d4, a, b, d)
  );
}

function straddles(p: number, q: number): boolean {
  return (p > 0 && q < 0) || (p < 0 && q > 0);
}

function touches(side: number, a: Vec2, b: Vec2, p: Vec2): boolean {
  return side === 0 && onSegment(a, b, p);
}

function cross(a: Vec2, b: Vec2, p: Vec2): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function onSegment(a: Vec2, b: Vec2, p: Vec2): boolean {
  return (
    Math.min(a.x, b.x) <= p.x &&
    p.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= p.y &&
    p.y <= Math.max(a.y, b.y)
  );
}

function isFiniteVec(p: Vec2): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}
