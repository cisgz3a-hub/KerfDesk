import { FillRule, unionD, type PathD } from 'clipper2-ts';
import { err, ok, type Result } from '../result';
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

// Weld / boolean / offset / dogbone ops return a canonical Result (ADR-131)
// instead of throwing: pure core must not throw for control flow (CLAUDE.md).
// The typed failure names the mode; its user-worded message is what the store
// surfaces as a toast for the reachable cases menu-gating can't pre-detect
// (WORKFLOW F-CNC22 error/empty states).
export type VectorOpError = {
  readonly kind:
    | 'too-few-objects'
    | 'open-contours'
    | 'empty-result'
    | 'collapsed'
    | 'no-corners'
    | 'bad-distance'
    | 'mixed-metadata'
    // The clipper2-ts engine threw on pathological/degenerate geometry. Before
    // ADR-131 the store's try/catch swallowed this; now the op catches the
    // third-party throw at the boundary and surfaces it as a Result so an
    // unexpected clipper failure toasts instead of escaping uncaught (self-audit
    // finding of the ARC-02 conversion).
    | 'operation-failed';
  readonly message: string;
};

const MIN_CLOSED_POINTS = 3;
const EPS = 1e-9;
const OPERATION_FAILED_MESSAGE = 'The operation could not be completed on these shapes.';

// Run a clipper2-ts call at the core/third-party boundary, converting any throw
// into a typed error Result. This is NOT throw-for-control-flow (CLAUDE.md bans
// that for OUR code): clipper is external and cannot be made to return a Result,
// so catching its throw here is the correct boundary discipline.
export function tryVectorOp<T>(run: () => T): Result<T, VectorOpError> {
  try {
    return ok(run());
  } catch {
    return err({ kind: 'operation-failed', message: OPERATION_FAILED_MESSAGE });
  }
}

export function isVectorPathObject(object: SceneObject): object is VectorSceneObject {
  return 'paths' in object;
}

export function materializeVectorObject(object: VectorSceneObject, id = object.id): ImportedSvg {
  const paths = object.paths.map((path) => ({
    color: path.color,
    ...(path.operationIds === undefined ? {} : { operationIds: path.operationIds }),
    polylines: path.polylines.map((polyline) => materializePolyline(polyline, object.transform)),
  }));
  return {
    ...objectPowerScale(object),
    ...(object.operationIds === undefined ? {} : { operationIds: object.operationIds }),
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
): Result<ImportedSvg, VectorOpError> {
  if (objects.length === 0) {
    return err({
      kind: 'too-few-objects',
      message: 'Weld requires selected closed vector contours.',
    });
  }
  if (!vectorObjectOutputMetadataCompatible(objects)) {
    return err({
      kind: 'mixed-metadata',
      message: 'Weld requires selected vector contours with matching output metadata.',
    });
  }
  const materialized = objects.map((object) => materializeVectorObject(object));
  const byColor = new Map<string, PathD[]>();
  for (const object of materialized) {
    for (const path of object.paths) {
      const paths = byColor.get(path.color) ?? [];
      for (const polyline of path.polylines) {
        if (!isClosedPolygon(polyline)) {
          return err({
            kind: 'open-contours',
            message: 'Weld requires selected closed vector contours.',
          });
        }
        paths.push(polylineToPathD(polyline));
      }
      byColor.set(path.color, paths);
    }
  }
  const paths: ColoredPath[] = [];
  for (const [color, subject] of byColor) {
    const welded = tryVectorOp(() => unionD(subject, FillRule.NonZero));
    if (welded.kind === 'error') return welded;
    paths.push({
      color,
      polylines: welded.value.map(pathDToPolyline).filter(isClosedPolygon),
    });
  }
  const filtered = paths.filter((path) => path.polylines.length > 0);
  if (filtered.length === 0) {
    return err({ kind: 'empty-result', message: 'Welding these shapes produced an empty result.' });
  }
  return ok({
    ...commonObjectMetadata(objects),
    kind: 'imported-svg',
    id,
    source: 'Welded paths',
    bounds: boundsForPaths(filtered) ?? firstBounds(objects),
    transform: IDENTITY_TRANSFORM,
    paths: filtered,
  });
}

export function vectorObjectOutputMetadataCompatible(
  objects: ReadonlyArray<VectorSceneObject>,
): boolean {
  if (objects.length <= 1) return true;
  const first = objectPowerScale(objects[0] as VectorSceneObject);
  return objects.slice(1).every((object) => objectMetadataEqual(first, objectPowerScale(object)));
}

function commonObjectMetadata(
  objects: ReadonlyArray<VectorSceneObject>,
): Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'> {
  // Metadata compatibility is checked by weldVectorObjects before this runs.
  return objectPowerScale(objects[0] as VectorSceneObject);
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

function objectMetadataEqual(
  left: Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'>,
  right: Pick<ImportedSvg, 'locked' | 'operationOverride' | 'powerScale'>,
): boolean {
  return (
    left.locked === right.locked &&
    Object.is(left.powerScale, right.powerScale) &&
    operationOverrideEqual(left.operationOverride, right.operationOverride)
  );
}

function operationOverrideEqual(
  left: ImportedSvg['operationOverride'],
  right: ImportedSvg['operationOverride'],
): boolean {
  const leftKeys = Object.keys(left ?? {}).sort();
  const rightKeys = Object.keys(right ?? {}).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => {
      if (key !== rightKeys[index]) return false;
      return Object.is(left?.[key as keyof typeof left], right?.[key as keyof typeof right]);
    })
  );
}

export function isClosedPolygon(polyline: Polyline): boolean {
  return polyline.closed && normalizeClosedPoints(polyline.points).length >= MIN_CLOSED_POINTS;
}

export function polylineToPathD(polyline: Polyline): PathD {
  return normalizeClosedPoints(polyline.points).map((point) => ({ x: point.x, y: point.y }));
}

export function pathDToPolyline(path: PathD): Polyline {
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

export function boundsForPaths(paths: ReadonlyArray<ColoredPath>): Bounds | null {
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
