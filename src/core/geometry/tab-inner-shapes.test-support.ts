// Frozen copy of the automatic-tab eligibility as it was before the inner-shape
// pass used a box index (tabs-bridges.ts at 2f6f84dec): every closed contour
// tested against every other. The oracle the indexed pass must match exactly.
import type { Polyline, Vec2 } from '../scene';
import type { AutomaticTabsSettings } from './tabs-bridges';

const MIN_CLOSED_POINTS = 3;
const EPS = 1e-9;

/** Per polyline, as automaticTabEligibility and applyAutomaticTabsToPolylines decided it. */
export function originalTabEligibility(
  polylines: ReadonlyArray<Polyline>,
  settings: AutomaticTabsSettings,
): ReadonlyArray<boolean> {
  return polylines.map(
    (polyline, index) =>
      polyline.closed && originalIsTabEligible(polyline, polylines, index, settings),
  );
}

function originalIsTabEligible(
  polyline: Polyline,
  polylines: ReadonlyArray<Polyline>,
  selfIndex: number,
  settings: AutomaticTabsSettings,
): boolean {
  if (!settings.tabSkipInnerShapes) return true;
  const points = normalizeClosedPoints(polyline.points);
  if (points.length < MIN_CLOSED_POINTS) return false;
  let depth = 0;
  for (let i = 0; i < polylines.length; i += 1) {
    if (i === selfIndex) continue;
    const candidate = polylines[i];
    if (candidate === undefined || !candidate.closed) continue;
    const candidatePoints = normalizeClosedPoints(candidate.points);
    if (candidatePoints.length >= MIN_CLOSED_POINTS && strictlyContains(candidatePoints, points)) {
      depth += 1;
    }
  }
  return depth % 2 === 0;
}

function normalizeClosedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  for (const point of points) {
    if (out.length > 0 && pointsEqual(out[out.length - 1] as Vec2, point)) continue;
    out.push(point);
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first !== undefined && last !== undefined && pointsEqual(first, last)) out.pop();
  return out;
}

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

function strictlyContains(container: ReadonlyArray<Vec2>, subject: ReadonlyArray<Vec2>): boolean {
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

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}
