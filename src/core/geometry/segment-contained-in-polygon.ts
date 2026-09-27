// Check the whole segment, not only its vertices. Intersections partition it
// into intervals whose containment cannot change before the next boundary.
import type { Vec2 } from '../scene';
import { pointInPolygon } from './point-in-polygon';

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

function insideOrOn(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  return (
    pointInPolygon(point, polygon) ||
    polygon.some((a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      if (b === undefined) return false;
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
    })
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
