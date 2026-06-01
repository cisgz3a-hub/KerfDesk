import type { Polyline, Vec2 } from '../scene';
import { simplifyCenterlinePoints } from './centerline-simplify';

const MAX_MERGE_GAP_PX = 2.25;
const MIN_STRAIGHT_DOT = 0.85;

type Endpoint = 'start' | 'end';

type MergeCandidate = {
  readonly aEndpoint: Endpoint;
  readonly bEndpoint: Endpoint;
};

export function mergeCollinearOpenPolylines(
  polylines: ReadonlyArray<Polyline>,
  simplifyTolerancePx: number,
): Polyline[] {
  const out: Polyline[] = polylines.map((polyline) => ({
    ...polyline,
    points: [...polyline.points],
  }));
  let merged = true;
  while (merged) {
    merged = false;
    outer: for (let a = 0; a < out.length; a += 1) {
      for (let b = a + 1; b < out.length; b += 1) {
        const aPolyline = out[a];
        const bPolyline = out[b];
        if (aPolyline === undefined || bPolyline === undefined) continue;
        const candidate = findMergeCandidate(aPolyline, bPolyline);
        if (candidate === null) continue;
        const mergedPolyline = mergePair(aPolyline, bPolyline, candidate, simplifyTolerancePx);
        out.splice(b, 1);
        out.splice(a, 1, mergedPolyline);
        merged = true;
        break outer;
      }
    }
  }
  return out;
}

function findMergeCandidate(
  a: Polyline | undefined,
  b: Polyline | undefined,
): MergeCandidate | null {
  if (a === undefined || b === undefined || a.closed || b.closed) return null;
  const candidates: MergeCandidate[] = [
    { aEndpoint: 'start', bEndpoint: 'start' },
    { aEndpoint: 'start', bEndpoint: 'end' },
    { aEndpoint: 'end', bEndpoint: 'start' },
    { aEndpoint: 'end', bEndpoint: 'end' },
  ];
  return candidates.find((candidate) => canMerge(a, b, candidate)) ?? null;
}

function canMerge(a: Polyline, b: Polyline, candidate: MergeCandidate): boolean {
  const aPoint = endpointPoint(a.points, candidate.aEndpoint);
  const bPoint = endpointPoint(b.points, candidate.bEndpoint);
  if (aPoint === undefined || bPoint === undefined) return false;
  if (distance(aPoint, bPoint) > MAX_MERGE_GAP_PX) return false;
  const aDirection = endpointDirection(a.points, candidate.aEndpoint);
  const bDirection = endpointDirection(b.points, candidate.bEndpoint);
  if (aDirection === null || bDirection === null) return false;
  return dot(aDirection, bDirection) <= -MIN_STRAIGHT_DOT;
}

function mergePair(
  a: Polyline,
  b: Polyline,
  candidate: MergeCandidate,
  simplifyTolerancePx: number,
): Polyline {
  const aPoints = candidate.aEndpoint === 'start' ? [...a.points].reverse() : [...a.points];
  const bPoints = candidate.bEndpoint === 'end' ? [...b.points].reverse() : [...b.points];
  const points = simplifyCenterlinePoints([...aPoints, ...bPoints.slice(1)], simplifyTolerancePx);
  return { closed: false, points };
}

function endpointPoint(points: ReadonlyArray<Vec2>, endpoint: Endpoint): Vec2 | undefined {
  return endpoint === 'start' ? points[0] : points[points.length - 1];
}

function endpointDirection(points: ReadonlyArray<Vec2>, endpoint: Endpoint): Vec2 | null {
  if (points.length < 2) return null;
  const edge =
    endpoint === 'start'
      ? vector(points[0], points[1])
      : vector(points[points.length - 1], points[points.length - 2]);
  const length = Math.hypot(edge.x, edge.y);
  return length === 0 ? null : { x: edge.x / length, y: edge.y / length };
}

function vector(from: Vec2 | undefined, to: Vec2 | undefined): Vec2 {
  return { x: (to?.x ?? 0) - (from?.x ?? 0), y: (to?.y ?? 0) - (from?.y ?? 0) };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}
