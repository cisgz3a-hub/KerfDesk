// The exact test behind "skip inner shapes" for automatic tabs: whether one
// closed contour lies strictly inside another, with no vertex on or outside it
// and no edge touching or crossing it. Moved unchanged from tabs-bridges.ts so
// the inner-shape pass can run it only on candidate pairs (ADR-494 Amendment 1).

import type { Vec2 } from '../scene';

const EPS = 1e-9;

function pointInPolygon(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const crossesY = a.y > point.y !== b.y > point.y;
    if (!crossesY) continue;
    const xAtY = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < xAtY) inside = !inside;
  }
  return inside;
}

export function strictlyContains(
  container: ReadonlyArray<Vec2>,
  subject: ReadonlyArray<Vec2>,
): boolean {
  if (
    subject.some(
      (point) => pointOnPolygonBoundary(point, container) || !pointInPolygon(point, container),
    )
  ) {
    return false;
  }
  for (let subjectIndex = 0; subjectIndex < subject.length; subjectIndex += 1) {
    const subjectStart = subject[subjectIndex];
    const subjectEnd = subject[(subjectIndex + 1) % subject.length];
    if (subjectStart === undefined || subjectEnd === undefined) continue;
    for (let containerIndex = 0; containerIndex < container.length; containerIndex += 1) {
      const containerStart = container[containerIndex];
      const containerEnd = container[(containerIndex + 1) % container.length];
      if (
        containerStart !== undefined &&
        containerEnd !== undefined &&
        segmentsIntersectOrTouch(subjectStart, subjectEnd, containerStart, containerEnd)
      ) {
        return false;
      }
    }
  }
  return true;
}

function pointOnPolygonBoundary(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  return polygon.some((start, index) => {
    const end = polygon[(index + 1) % polygon.length];
    return end !== undefined && pointOnSegment(point, start, end);
  });
}

function segmentsIntersectOrTouch(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (Math.abs(abC) <= EPS && pointOnSegment(c, a, b)) return true;
  if (Math.abs(abD) <= EPS && pointOnSegment(d, a, b)) return true;
  if (Math.abs(cdA) <= EPS && pointOnSegment(a, c, d)) return true;
  if (Math.abs(cdB) <= EPS && pointOnSegment(b, c, d)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2): boolean {
  if (Math.abs(cross(start, end, point)) > EPS) return false;
  return (
    point.x >= Math.min(start.x, end.x) - EPS &&
    point.x <= Math.max(start.x, end.x) + EPS &&
    point.y >= Math.min(start.y, end.y) - EPS &&
    point.y <= Math.max(start.y, end.y) + EPS
  );
}

function cross(a: Vec2, b: Vec2, c: Vec2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
