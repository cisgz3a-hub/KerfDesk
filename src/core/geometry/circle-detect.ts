// Select Circles (LightBurn Edit menu): which artwork is a circle, and how big.
// A drawn ellipse counts when its placed width and height match. Other vector
// artwork counts when its whole outline is one closed path whose vertices and
// edge midpoints all sit on one circle, so a coarse polygon is not mistaken
// for a sampled circle. Sizes are world diameters in millimetres.

import { isClosedEnough, type Polyline, type SceneObject, type Vec2 } from '../scene';
import { isClosedPolygon, isVectorPathObject, materializeVectorObject } from './vector-path-tools';

const MIN_SAMPLED_VERTICES = 12;
const ABSOLUTE_TOLERANCE_MM = 0.02;
const RELATIVE_TOLERANCE = 0.005;

/** The world diameter of a circular object, or null when it is not one circle. */
export function objectCircleDiameterMm(object: SceneObject): number | null {
  if (object.kind === 'shape' && object.spec.kind === 'ellipse') {
    const width = object.spec.widthMm * Math.abs(object.transform.scaleX);
    const height = object.spec.heightMm * Math.abs(object.transform.scaleY);
    return width > 0 && Math.abs(width - height) <= tolerance(width / 2)
      ? (width + height) / 2
      : null;
  }
  if (object.kind === 'shape' || object.kind === 'text' || !isVectorPathObject(object)) return null;
  const polylines = materializeVectorObject(object)
    .paths.flatMap((path) => path.polylines)
    .filter((polyline) => polyline.points.length > 0);
  const only = polylines.length === 1 ? polylines[0] : undefined;
  return only === undefined ? null : polylineCircleDiameter(only);
}

export type CircleSizeQuery =
  | { readonly kind: 'exact'; readonly diameterMm: number; readonly toleranceMm: number }
  | { readonly kind: 'range'; readonly minMm: number; readonly maxMm: number };

export function circleMatchesQuery(diameterMm: number, query: CircleSizeQuery): boolean {
  if (query.kind === 'exact') return Math.abs(diameterMm - query.diameterMm) <= query.toleranceMm;
  return diameterMm >= query.minMm && diameterMm <= query.maxMm;
}

function polylineCircleDiameter(polyline: Polyline): number | null {
  if (!(isClosedPolygon(polyline) || isClosedEnough(polyline))) return null;
  const points = withoutClosingPoint(polyline.points);
  if (points.length < MIN_SAMPLED_VERTICES) return null;
  const centre = boxCentre(points);
  const radius = points.reduce((sum, point) => sum + distance(point, centre), 0) / points.length;
  if (!(radius > 0)) return null;
  const limit = tolerance(radius);
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index] as Vec2;
    const next = points[(index + 1) % points.length] as Vec2;
    const middle = { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
    if (Math.abs(distance(point, centre) - radius) > limit) return null;
    if (Math.abs(distance(middle, centre) - radius) > limit) return null;
  }
  return radius * 2;
}

function tolerance(radius: number): number {
  return Math.max(ABSOLUTE_TOLERANCE_MM, radius * RELATIVE_TOLERANCE);
}

function withoutClosingPoint(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const first = points[0];
  const last = points.at(-1);
  if (first === undefined || last === undefined || points.length < 2) return points;
  return first.x === last.x && first.y === last.y ? points.slice(0, -1) : points;
}

function boxCentre(points: ReadonlyArray<Vec2>): Vec2 {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
