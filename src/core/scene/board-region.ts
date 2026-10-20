// board-region — a placed board's outline as a containment region in scene
// space (ADR-636), so placement can keep artwork inside a round or custom-shape
// board rather than inside its bounding box. Rectangles stay axis-aligned
// boxes; a circle outline is a disc; a closed polyline outline (a custom-shape
// board) is a simple polygon. Pure — no DOM, no I/O.

import { transformedBBox, type AABB } from './hit-test';
import type { ShapeObject, Vec2 } from './scene-object';
import { applyTransform } from './transform';

export type BoardRegion =
  | { readonly kind: 'rect'; readonly bounds: AABB }
  | {
      readonly kind: 'circle';
      readonly bounds: AABB;
      readonly center: Vec2;
      readonly radius: number;
    }
  | { readonly kind: 'polygon'; readonly bounds: AABB; readonly points: ReadonlyArray<Vec2> };

// Containment is judged to a micron so a box placed flush with an edge counts.
const CONTAINMENT_EPSILON_MM = 1e-6;

export function boardRegionOf(board: ShapeObject): BoardRegion {
  const bounds = transformedBBox(board);
  if (board.spec.kind === 'ellipse') {
    const radius = Math.min(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
    const center = { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
    return { kind: 'circle', bounds, center, radius };
  }
  if (board.spec.kind === 'polyline' && board.spec.closed && board.spec.points.length >= 3) {
    const points = board.spec.points.map((point) => applyTransform(point, board.transform));
    return { kind: 'polygon', bounds, points };
  }
  return { kind: 'rect', bounds };
}

/** True when `box` lies inside the region with at least `marginMm` clearance. */
export function boxInsideBoardRegion(region: BoardRegion, box: AABB, marginMm: number): boolean {
  const margin = Math.max(0, marginMm) - CONTAINMENT_EPSILON_MM;
  switch (region.kind) {
    case 'rect':
      return (
        box.minX >= region.bounds.minX + margin &&
        box.maxX <= region.bounds.maxX - margin &&
        box.minY >= region.bounds.minY + margin &&
        box.maxY <= region.bounds.maxY - margin
      );
    case 'circle':
      // A box's farthest points from the centre are its corners.
      return boxCorners(box).every(
        (corner) =>
          Math.hypot(corner.x - region.center.x, corner.y - region.center.y) <=
          region.radius - margin,
      );
    case 'polygon':
      return boxInsidePolygon(region.points, box, Math.max(0, marginMm));
  }
}

/**
 * A point well inside the region to centre artwork on: the bounding-box centre
 * when it is inside, otherwise the sampled point farthest from the outline
 * (an approximate pole of inaccessibility) — needed for L-shaped or crescent
 * boards whose box centre falls outside the material.
 */
export function boardRegionCenter(region: BoardRegion): Vec2 {
  const center = {
    x: (region.bounds.minX + region.bounds.maxX) / 2,
    y: (region.bounds.minY + region.bounds.maxY) / 2,
  };
  if (region.kind !== 'polygon') return region.kind === 'circle' ? region.center : center;
  if (pointInPolygon(region.points, center)) return center;
  return polygonPole(region.points, region.bounds);
}

/** Where Fit to board centres artwork: the widest part of a custom shape. */
export function boardRegionFitCenter(region: BoardRegion): Vec2 {
  return region.kind === 'polygon'
    ? polygonPole(region.points, region.bounds)
    : boardRegionCenter(region);
}

function boxInsidePolygon(points: ReadonlyArray<Vec2>, box: AABB, clearance: number): boolean {
  // A box flush with an edge has corners on the outline; judge a hair inside.
  const inner = insetBox(box, CONTAINMENT_EPSILON_MM);
  if (!boxCorners(inner).every((corner) => pointInPolygon(points, corner))) return false;
  // Every corner inside still lets a notch cut through the box, so also
  // require each outline edge to stay out of it, and clear of it by the margin.
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    if (clearance <= CONTAINMENT_EPSILON_MM) {
      if (segmentTouchesBox(a, b, inner)) return false;
    } else if (segmentBoxDistance(a, b, box) < clearance - CONTAINMENT_EPSILON_MM) {
      return false;
    }
  }
  return true;
}

function insetBox(box: AABB, by: number): AABB {
  return { minX: box.minX + by, minY: box.minY + by, maxX: box.maxX - by, maxY: box.maxY - by };
}

export function pointInPolygon(points: ReadonlyArray<Vec2>, p: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const a = points[i];
    const b = points[j];
    if (a === undefined || b === undefined) continue;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonPole(points: ReadonlyArray<Vec2>, bounds: AABB): Vec2 {
  let best: Vec2 = points[0] ?? { x: bounds.minX, y: bounds.minY };
  let bestDistance = -1;
  let area = bounds;
  // Two passes: a coarse grid over the box, then a finer one around the winner.
  for (let pass = 0; pass < 2; pass += 1) {
    const steps = 24;
    const dx = (area.maxX - area.minX) / steps;
    const dy = (area.maxY - area.minY) / steps;
    for (let i = 0; i <= steps; i += 1) {
      for (let j = 0; j <= steps; j += 1) {
        const p = { x: area.minX + i * dx, y: area.minY + j * dy };
        if (!pointInPolygon(points, p)) continue;
        const distance = distanceToOutline(points, p);
        if (distance > bestDistance) {
          bestDistance = distance;
          best = p;
        }
      }
    }
    area = { minX: best.x - dx, maxX: best.x + dx, minY: best.y - dy, maxY: best.y + dy };
  }
  return best;
}

function distanceToOutline(points: ReadonlyArray<Vec2>, p: Vec2): number {
  let nearest = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    if (a === undefined || b === undefined) continue;
    nearest = Math.min(nearest, pointSegmentDistance(p, a, b));
  }
  return nearest;
}

function boxCorners(box: AABB): ReadonlyArray<Vec2> {
  return [
    { x: box.minX, y: box.minY },
    { x: box.maxX, y: box.minY },
    { x: box.maxX, y: box.maxY },
    { x: box.minX, y: box.maxY },
  ];
}

function segmentBoxDistance(a: Vec2, b: Vec2, box: AABB): number {
  if (segmentTouchesBox(a, b, box)) return 0;
  const corners = boxCorners(box);
  return Math.min(
    pointBoxDistance(a, box),
    pointBoxDistance(b, box),
    ...corners.map((corner) => pointSegmentDistance(corner, a, b)),
  );
}

// Liang–Barsky clip: does any part of segment ab lie in the closed box?
function segmentTouchesBox(a: Vec2, b: Vec2, box: AABB): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const edges: ReadonlyArray<readonly [number, number]> = [
    [-dx, a.x - box.minX],
    [dx, box.maxX - a.x],
    [-dy, a.y - box.minY],
    [dy, box.maxY - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function pointBoxDistance(p: Vec2, box: AABB): number {
  const dx = Math.max(box.minX - p.x, 0, p.x - box.maxX);
  const dy = Math.max(box.minY - p.y, 0, p.y - box.maxY);
  return Math.hypot(dx, dy);
}

function pointSegmentDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
