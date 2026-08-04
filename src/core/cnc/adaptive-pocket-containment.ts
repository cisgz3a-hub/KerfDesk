import { pointInPolygon } from '../geometry';
import type { Polyline, Vec2 } from '../scene';
import type { AdaptivePocketPlan, AdaptivePocketSequence } from './adaptive-pocket';
import {
  boundaryIndex,
  edgesNearBounds,
  type BoundaryIndex,
} from './adaptive-pocket-boundary-index';

// The wall-adjacent offset chord error and emitted XY words are each bounded to 0.001 mm. Keep
// only their combined allowance here; this must never scale with the coarser removal grid.
const CONTAINMENT_TOLERANCE_MM = 0.002;
const CONTAINMENT_FAILURE =
  'Adaptive verification found a cutting move outside the requested pocket.';

type ContainmentGeometry = {
  readonly boundary: BoundaryIndex;
  readonly contours: ReadonlyArray<Polyline>;
  readonly toolRadiusMm: number;
};

export function adaptivePocketContainmentIssue(
  contours: ReadonlyArray<Polyline>,
  toolRadiusMm: number,
  plan: Extract<AdaptivePocketPlan, { readonly ok: true }>,
): string | null {
  const boundary = boundaryIndex(contours, toolRadiusMm);
  if (boundary === null) return CONTAINMENT_FAILURE;
  const geometry = { boundary, contours, toolRadiusMm };
  return plan.sequences.every((sequence) => sequenceIsContained(sequence, geometry))
    ? null
    : CONTAINMENT_FAILURE;
}

function sequenceIsContained(
  sequence: AdaptivePocketSequence,
  geometry: ContainmentGeometry,
): boolean {
  if (!circleCutIsContained(sequence.entryCenter, sequence.entryRadiusMm, geometry)) return false;
  const entryEnd = {
    x: sequence.entryCenter.x + sequence.entryRadiusMm,
    y: sequence.entryCenter.y,
  };
  if (!linkedRingsAreContained(sequence.rings, entryEnd, geometry)) return false;
  return independentRingsAreContained(sequence.finishRings, geometry);
}

function linkedRingsAreContained(
  rings: ReadonlyArray<Polyline>,
  initialPoint: Vec2,
  geometry: ContainmentGeometry,
): boolean {
  let previous = initialPoint;
  for (const ring of rings) {
    const result = linkedRingResult(ring, previous, geometry);
    if (!result.ok) return false;
    previous = result.end;
  }
  return true;
}

type LinkedRingResult = { readonly ok: true; readonly end: Vec2 } | { readonly ok: false };

function linkedRingResult(
  ring: Polyline,
  previous: Vec2,
  geometry: ContainmentGeometry,
): LinkedRingResult {
  const first = ring.points[0];
  if (first === undefined) return { ok: true, end: previous };
  if (!segmentCutIsContained(previous, first, geometry)) return { ok: false };
  if (!polylineCutIsContained(ring, geometry)) return { ok: false };
  return { ok: true, end: ring.points[ring.points.length - 1] ?? first };
}

function independentRingsAreContained(
  rings: ReadonlyArray<Polyline>,
  geometry: ContainmentGeometry,
): boolean {
  return rings.every((ring) => polylineCutIsContained(ring, geometry));
}

function polylineCutIsContained(ring: Polyline, geometry: ContainmentGeometry): boolean {
  const first = ring.points[0];
  if (first === undefined) return true;
  if (!pointCutIsContained(first, geometry)) return false;
  for (let index = 1; index < ring.points.length; index += 1) {
    const start = ring.points[index - 1];
    const end = ring.points[index];
    if (start === undefined) continue;
    if (end === undefined) continue;
    if (!segmentCutIsContained(start, end, geometry)) return false;
  }
  return true;
}

function circleCutIsContained(
  center: Vec2,
  pathRadiusMm: number,
  geometry: ContainmentGeometry,
): boolean {
  if (!finitePoint(center)) return false;
  if (!positiveFinite(pathRadiusMm)) return false;
  if (!positiveFinite(geometry.toolRadiusMm)) return false;
  const start = { x: center.x + pathRadiusMm, y: center.y };
  if (!pointCutIsContained(start, geometry)) return false;
  const reachMm = pathRadiusMm + geometry.toolRadiusMm;
  for (const [edgeStart, edgeEnd] of edgesNearBounds(geometry.boundary, {
    minX: center.x - reachMm,
    minY: center.y - reachMm,
    maxX: center.x + reachMm,
    maxY: center.y + reachMm,
  })) {
    const minimumCenterDistance = pointToSegmentDistance(center, edgeStart, edgeEnd);
    const maximumCenterDistance = Math.max(distance(center, edgeStart), distance(center, edgeEnd));
    const circleDistance = distanceFromCircle(
      pathRadiusMm,
      minimumCenterDistance,
      maximumCenterDistance,
    );
    if (circleDistance + CONTAINMENT_TOLERANCE_MM < geometry.toolRadiusMm) return false;
  }
  return true;
}

function distanceFromCircle(pathRadiusMm: number, minimumMm: number, maximumMm: number): number {
  if (pathRadiusMm < minimumMm) return minimumMm - pathRadiusMm;
  if (pathRadiusMm > maximumMm) return pathRadiusMm - maximumMm;
  return 0;
}

function segmentCutIsContained(start: Vec2, end: Vec2, geometry: ContainmentGeometry): boolean {
  if (!finitePoint(start) || !finitePoint(end)) return false;
  const margin = geometry.toolRadiusMm;
  for (const [edgeStart, edgeEnd] of edgesNearBounds(geometry.boundary, {
    minX: Math.min(start.x, end.x) - margin,
    minY: Math.min(start.y, end.y) - margin,
    maxX: Math.max(start.x, end.x) + margin,
    maxY: Math.max(start.y, end.y) + margin,
  })) {
    const clearance = segmentToSegmentDistance(start, end, edgeStart, edgeEnd);
    if (clearance + CONTAINMENT_TOLERANCE_MM < geometry.toolRadiusMm) return false;
  }
  return true;
}

function pointCutIsContained(point: Vec2, geometry: ContainmentGeometry): boolean {
  if (!finitePoint(point)) return false;
  if (!pointInContours(point, geometry.contours)) return false;
  const margin = geometry.toolRadiusMm;
  for (const [start, end] of edgesNearBounds(geometry.boundary, {
    minX: point.x - margin,
    minY: point.y - margin,
    maxX: point.x + margin,
    maxY: point.y + margin,
  })) {
    const clearance = pointToSegmentDistance(point, start, end);
    if (clearance + CONTAINMENT_TOLERANCE_MM < geometry.toolRadiusMm) return false;
  }
  return true;
}

function segmentToSegmentDistance(a: Vec2, b: Vec2, c: Vec2, d: Vec2): number {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointToSegmentDistance(a, c, d),
    pointToSegmentDistance(b, c, d),
    pointToSegmentDistance(c, a, b),
    pointToSegmentDistance(d, a, b),
  );
}

function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC === 0 && pointOnSegment(c, a, b)) return true;
  if (abD === 0 && pointOnSegment(d, a, b)) return true;
  if (cdA === 0 && pointOnSegment(a, c, d)) return true;
  if (cdB === 0 && pointOnSegment(b, c, d)) return true;
  return abC > 0 !== abD > 0 && cdA > 0 !== cdB > 0;
}

function pointOnSegment(point: Vec2, start: Vec2, end: Vec2): boolean {
  return (
    point.x >= Math.min(start.x, end.x) &&
    point.x <= Math.max(start.x, end.x) &&
    point.y >= Math.min(start.y, end.y) &&
    point.y <= Math.max(start.y, end.y)
  );
}

function cross(a: Vec2, b: Vec2, point: Vec2): number {
  return (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
}

function pointToSegmentDistance(point: Vec2, start: Vec2, end: Vec2): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return distance(point, { x: start.x + t * dx, y: start.y + t * dy });
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointInContours(point: Vec2, contours: ReadonlyArray<Polyline>): boolean {
  let inside = false;
  for (const contour of contours) if (pointInPolygon(point, contour.points)) inside = !inside;
  return inside;
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function positiveFinite(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
