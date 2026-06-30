import { FillRule, unionD, type PathD } from 'clipper2-ts';
import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import { applyTransform } from '../scene/transform';

export type VectorSceneObject = Extract<
  SceneObject,
  { readonly paths: ReadonlyArray<ColoredPath> }
>;

const MIN_CLOSED_POINTS = 3;
const EPS = 1e-9;

export function isVectorPathObject(object: SceneObject): object is VectorSceneObject {
  return 'paths' in object;
}

export function materializeVectorObject(object: VectorSceneObject, id = object.id): ImportedSvg {
  const paths = object.paths.map((path) => ({
    color: path.color,
    polylines: path.polylines.map((polyline) => materializePolyline(polyline, object.transform)),
  }));
  return {
    ...objectPowerScale(object),
    kind: 'imported-svg',
    id,
    source: `${displaySource(object)} (paths)`,
    bounds: boundsForPaths(paths) ?? object.bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

export function weldVectorObjects(
  objects: ReadonlyArray<VectorSceneObject>,
  id: string,
): ImportedSvg {
  if (objects.length === 0) {
    throw new Error('Weld requires selected closed vector contours.');
  }
  const materialized = objects.map((object) => materializeVectorObject(object));
  const byColor = new Map<string, PathD[]>();
  for (const object of materialized) {
    for (const path of object.paths) {
      const paths = byColor.get(path.color) ?? [];
      for (const polyline of path.polylines) {
        if (!isClosedPolygon(polyline)) {
          throw new Error('Weld requires selected closed vector contours.');
        }
        paths.push(polylineToPathD(polyline));
      }
      byColor.set(path.color, paths);
    }
  }
  const paths: ColoredPath[] = [];
  for (const [color, subject] of byColor) {
    const welded = unionD(subject, FillRule.NonZero);
    paths.push({
      color,
      polylines: welded.map(pathDToPolyline).filter(isClosedPolygon),
    });
  }
  const filtered = paths.filter((path) => path.polylines.length > 0);
  if (filtered.length === 0) {
    throw new Error('Weld requires selected closed vector contours.');
  }
  return {
    kind: 'imported-svg',
    id,
    source: 'Welded paths',
    bounds: boundsForPaths(filtered) ?? firstBounds(objects),
    transform: IDENTITY_TRANSFORM,
    paths: filtered,
  };
}

function materializePolyline(polyline: Polyline, transform: SceneObject['transform']): Polyline {
  return {
    closed: polyline.closed,
    points: polyline.points.map((point) => cleanPoint(applyTransform(point, transform))),
  };
}

function displaySource(object: VectorSceneObject): string {
  switch (object.kind) {
    case 'text':
      return `Text: ${object.content}`;
    case 'shape':
      return `Shape: ${object.spec.kind}`;
    case 'imported-svg':
    case 'traced-image':
      return object.source;
  }
}

function objectPowerScale(
  object: VectorSceneObject,
): Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'> {
  return {
    ...(object.locked === undefined ? {} : { locked: object.locked }),
    ...(object.operationOverride === undefined
      ? {}
      : { operationOverride: object.operationOverride }),
    ...(object.powerScale === undefined ? {} : { powerScale: object.powerScale }),
  };
}

function isClosedPolygon(polyline: Polyline): boolean {
  return polyline.closed && normalizeClosedPoints(polyline.points).length >= MIN_CLOSED_POINTS;
}

function polylineToPathD(polyline: Polyline): PathD {
  return normalizeClosedPoints(polyline.points).map((point) => ({ x: point.x, y: point.y }));
}

function pathDToPolyline(path: PathD): Polyline {
  const points = path.map((point) => cleanPoint(point));
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

function normalizeClosedPoints(points: ReadonlyArray<Vec2>): ReadonlyArray<Vec2> {
  const out: Vec2[] = [];
  for (const point of points) {
    if (out.length === 0 || !pointsEqual(out[out.length - 1] as Vec2, point)) {
      out.push(point);
    }
  }
  const first = out[0];
  const last = out[out.length - 1];
  if (first !== undefined && last !== undefined && pointsEqual(first, last)) out.pop();
  return out;
}

function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds | null {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      for (const point of polyline.points) {
        minX = Math.min(minX, point.x);
        minY = Math.min(minY, point.y);
        maxX = Math.max(maxX, point.x);
        maxY = Math.max(maxY, point.y);
      }
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { minX, minY, maxX, maxY };
}

function firstBounds(objects: ReadonlyArray<VectorSceneObject>): Bounds {
  return objects[0]?.bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS;
}

function cleanPoint(point: Vec2): Vec2 {
  return { x: cleanCoord(point.x), y: cleanCoord(point.y) };
}

function cleanCoord(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}
