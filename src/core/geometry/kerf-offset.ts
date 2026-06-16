import { EndType, inflatePathsD, isPositiveD, JoinType, type PathD } from 'clipper2-ts';
import type { Polyline, Vec2 } from '../scene';

const OFFSET_PRECISION_DECIMALS = 3;
const MIN_CLOSED_POINTS = 3;
const COORD_EPS = 1e-9;

export function offsetClosedPolylinesForKerf(
  polylines: ReadonlyArray<Polyline>,
  kerfOffsetMm: number,
): ReadonlyArray<Polyline> {
  if (!Number.isFinite(kerfOffsetMm) || kerfOffsetMm === 0) return polylines;
  const paths = polylines.map(polylineToPathD).filter((path) => path.length >= MIN_CLOSED_POINTS);
  if (paths.length === 0) return [];
  const oriented = orientByContainment(paths);
  return inflatePathsD(
    [...oriented],
    kerfOffsetMm,
    JoinType.Miter,
    EndType.Polygon,
    2,
    OFFSET_PRECISION_DECIMALS,
  ).map(pathDToPolyline);
}

function polylineToPathD(polyline: Polyline): PathD {
  const out: PathD = [];
  for (const point of polyline.points) {
    if (out.length > 0 && pointsEqual(out[out.length - 1] as Vec2, point)) continue;
    out.push({ x: point.x, y: point.y });
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first !== undefined && last !== undefined && pointsEqual(first, last)) out.pop();
  return out;
}

function pathDToPolyline(path: PathD): Polyline {
  const points = path.map((point) => ({ x: cleanCoord(point.x), y: cleanCoord(point.y) }));
  const first = points[0];
  const last = points[points.length - 1];
  return {
    closed: true,
    points:
      first !== undefined && last !== undefined && !pointsEqual(first, last)
        ? [...points, first]
        : points,
  };
}

function orientByContainment(paths: ReadonlyArray<PathD>): ReadonlyArray<PathD> {
  return paths.map((path, index) => {
    const depth = containingPathCount(path, paths, index);
    const shouldBePositive = depth % 2 === 1;
    return isPositiveD(path) === shouldBePositive ? path : [...path].reverse();
  });
}

function containingPathCount(path: PathD, paths: ReadonlyArray<PathD>, selfIndex: number): number {
  const probe = path[0];
  if (probe === undefined) return 0;
  let depth = 0;
  for (let i = 0; i < paths.length; i += 1) {
    if (i === selfIndex) continue;
    const candidate = paths[i];
    if (candidate !== undefined && pointInPolygon(probe, candidate)) depth += 1;
  }
  return depth;
}

function pointInPolygon(point: Vec2, polygon: PathD): boolean {
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

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= COORD_EPS && Math.abs(a.y - b.y) <= COORD_EPS;
}

function cleanCoord(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
