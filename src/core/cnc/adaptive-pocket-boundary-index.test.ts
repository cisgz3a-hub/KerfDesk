import { describe, expect, it } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import {
  boundaryIndex,
  edgesNearBounds,
  type BoundaryEdge,
} from './adaptive-pocket-boundary-index';

const TOOL_RADIUS_MM = 2;
const CASES = 2_000;

function regularPolygon(segments: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: segments }, (_, index) => {
      const angle = (index / segments) * Math.PI * 2;
      return { x: 30 + Math.cos(angle) * 30, y: 30 + Math.sin(angle) * 30 };
    }),
  };
}

function rectangle(x: number, y: number, width: number, height: number): Polyline {
  return {
    closed: true,
    points: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  };
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function randomPoint(random: () => number): Vec2 {
  return { x: -20 + random() * 150, y: -20 + random() * 100 };
}

describe('adaptive pocket boundary index', () => {
  const contours = [regularPolygon(360), rectangle(80, 0, 30, 30)];
  const index = boundaryIndex(contours, TOOL_RADIUS_MM);
  if (index === null) throw new Error('expected a boundary index');

  it('matches a full edge scan for deterministic cutter capsules', () => {
    const random = seededRandom(0xa11ce);
    let mismatches = 0;
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const start = randomPoint(random);
      const end = randomPoint(random);
      const bounds = {
        minX: Math.min(start.x, end.x) - TOOL_RADIUS_MM,
        minY: Math.min(start.y, end.y) - TOOL_RADIUS_MM,
        maxX: Math.max(start.x, end.x) + TOOL_RADIUS_MM,
        maxY: Math.max(start.y, end.y) + TOOL_RADIUS_MM,
      };
      const full = index.edges.some(
        ([edgeStart, edgeEnd]) =>
          segmentToSegmentDistance(start, end, edgeStart, edgeEnd) < TOOL_RADIUS_MM,
      );
      const indexed = edgesNearBounds(index, bounds).some(
        ([edgeStart, edgeEnd]) =>
          segmentToSegmentDistance(start, end, edgeStart, edgeEnd) < TOOL_RADIUS_MM,
      );
      if (full !== indexed) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });

  it('matches a full edge scan for deterministic helical circles', () => {
    const random = seededRandom(0xc1ac1e);
    let mismatches = 0;
    for (let caseIndex = 0; caseIndex < CASES; caseIndex += 1) {
      const center = randomPoint(random);
      const pathRadiusMm = 0.1 + random() * 30;
      const reachMm = pathRadiusMm + TOOL_RADIUS_MM;
      const bounds = {
        minX: center.x - reachMm,
        minY: center.y - reachMm,
        maxX: center.x + reachMm,
        maxY: center.y + reachMm,
      };
      const unsafe = (edge: BoundaryEdge): boolean =>
        circleToEdgeDistance(center, pathRadiusMm, edge) < TOOL_RADIUS_MM;
      const full = index.edges.some(unsafe);
      const indexed = edgesNearBounds(index, bounds).some(unsafe);
      if (full !== indexed) mismatches += 1;
    }
    expect(mismatches).toBe(0);
  });
});

function circleToEdgeDistance(
  center: Vec2,
  pathRadiusMm: number,
  [start, end]: BoundaryEdge,
): number {
  const minimumMm = pointToSegmentDistance(center, start, end);
  const maximumMm = Math.max(distance(center, start), distance(center, end));
  if (pathRadiusMm < minimumMm) return minimumMm - pathRadiusMm;
  if (pathRadiusMm > maximumMm) return pathRadiusMm - maximumMm;
  return 0;
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
