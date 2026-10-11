// Check the whole segment, not only its vertices. Intersections partition it
// into intervals whose containment cannot change before the next boundary.
import type { Vec2 } from '../scene';
import { pointInPolygon } from './point-in-polygon';
import type { PolygonEdgeIndex } from './polygon-edge-index';

const EPS = 1e-9;

export function segmentContainedInPolygon(
  from: Vec2,
  to: Vec2,
  polygon: ReadonlyArray<Vec2>,
): boolean {
  if (!insideOrOn(from, polygon) || !insideOrOn(to, polygon)) return false;
  const times = [0, 1];
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    if (a !== undefined && b !== undefined) addBoundaryTimes(times, from, to, a, b);
  }
  times.sort((a, b) => a - b);
  return times.every((time, index) => {
    const next = times[index + 1];
    if (next === undefined || next <= time) return true;
    const t = (time + next) / 2;
    return insideOrOn(
      { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) },
      polygon,
    );
  });
}

/**
 * Exactly `segmentContainedInPolygon(from, to, index.polygon)`, consulting only
 * edges near each probe. An edge far from the segment can add only a clamped
 * 0 or 1 to the boundary times (both already present), and an edge far from a
 * point cannot hold it on the boundary, so leaving them out changes nothing.
 * The query margins exceed every tolerance below, with room for rounding.
 */
export function segmentContainedInIndexedPolygon(
  from: Vec2,
  to: Vec2,
  index: PolygonEdgeIndex,
): boolean {
  if (!indexedInsideOrOn(from, index) || !indexedInsideOrOn(to, index)) return false;
  const times = [0, 1];
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const margin = 4 * EPS * (1 + length + index.maxEdgeLength) + roundingMargin(index, from, to);
  index.forEachEdgeNear(segmentBox(from, to), margin, (a, b) => {
    addBoundaryTimes(times, from, to, a, b);
    return false;
  });
  times.sort((a, b) => a - b);
  return times.every((time, i) => {
    const next = times[i + 1];
    if (next === undefined || next <= time) return true;
    const t = (time + next) / 2;
    return indexedInsideOrOn(
      { x: from.x + t * (to.x - from.x), y: from.y + t * (to.y - from.y) },
      index,
    );
  });
}

function indexedInsideOrOn(point: Vec2, index: PolygonEdgeIndex): boolean {
  if (index.containsPoint(point)) return true;
  const box = { minX: point.x, minY: point.y, maxX: point.x, maxY: point.y };
  const margin = 4 * EPS + roundingMargin(index, point, point);
  return index.forEachEdgeNear(box, margin, (a, b) => onEdge(point, a, b));
}

function roundingMargin(index: PolygonEdgeIndex, from: Vec2, to: Vec2): number {
  const scale = Math.max(
    1,
    index.magnitude,
    Math.abs(from.x),
    Math.abs(from.y),
    Math.abs(to.x),
    Math.abs(to.y),
  );
  return 1e-9 * scale;
}

function segmentBox(from: Vec2, to: Vec2) {
  return {
    minX: Math.min(from.x, to.x),
    minY: Math.min(from.y, to.y),
    maxX: Math.max(from.x, to.x),
    maxY: Math.max(from.y, to.y),
  };
}

function insideOrOn(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  return (
    pointInPolygon(point, polygon) ||
    polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return b !== undefined && onEdge(point, a, b);
    })
  );
}

function onEdge(point: Vec2, a: Vec2, b: Vec2): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y) <= EPS;
  return (
    Math.abs(cross(point.x - a.x, point.y - a.y, dx, dy)) <= EPS * length &&
    point.x >= Math.min(a.x, b.x) - EPS &&
    point.x <= Math.max(a.x, b.x) + EPS &&
    point.y >= Math.min(a.y, b.y) - EPS &&
    point.y <= Math.max(a.y, b.y) + EPS
  );
}

function addBoundaryTimes(times: number[], from: Vec2, to: Vec2, a: Vec2, b: Vec2): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const ex = b.x - a.x;
  const ey = b.y - a.y;
  const determinant = cross(dx, dy, ex, ey);
  const px = a.x - from.x;
  const py = a.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  if (Math.abs(determinant) > EPS * length * Math.hypot(ex, ey)) {
    const t = cross(px, py, ex, ey) / determinant;
    const u = cross(px, py, dx, dy) / determinant;
    if (t >= -EPS && t <= 1 + EPS && u >= -EPS && u <= 1 + EPS) times.push(clamp(t));
    return;
  }
  // Collinear overlaps may enter or leave the boundary at either endpoint.
  if (Math.abs(cross(px, py, dx, dy)) <= EPS * length) {
    const squared = length * length;
    times.push(clamp((px * dx + py * dy) / squared));
    times.push(clamp(((b.x - from.x) * dx + (b.y - from.y) * dy) / squared));
  }
}

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}
