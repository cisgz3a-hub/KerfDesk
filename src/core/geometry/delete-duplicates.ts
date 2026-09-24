// delete-duplicates — plan Edit → Delete Duplicates (ADR-377). Contours are
// compared in world space, in the order given (scene order), and the first
// copy is kept. Two contours only count as copies when they would run under
// the same operations with the same object output settings, so a line that is
// meant to be cut and also scored is never touched.
//
// Imported paths lose just their repeated contours. Text and shapes are
// generated from their settings, so they are removed only when every contour
// repeats. Images, traced images and reliefs are never candidates, and objects
// that others depend on are never changed.

import {
  applyTransform,
  curveSubpathBounds,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  flattenCurveSubpath,
  type Bounds,
  type ColoredPath,
  type CurveSubpath,
  type ImportedSvg,
  type Polyline,
  type SceneObject,
  type ShapeObject,
  type TextObject,
  type Vec2,
} from '../scene';
import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';
import {
  comparableContour,
  createContourIndex,
  DUPLICATE_TOLERANCE_MM,
  type ComparableContour,
  type ContourIndex,
} from './duplicate-contours';

export type DeleteDuplicatesOptions = {
  readonly toleranceMm?: number;
  // Objects that others depend on, such as an image's mask or a path text's
  // guide. They are checked first, so they are the copy that stays, and they
  // are never removed or edited even when they repeat each other.
  readonly keepIds?: ReadonlySet<string>;
};

export type DeleteDuplicatesPlan = {
  readonly removedObjectIds: ReadonlySet<string>;
  readonly editedObjects: ReadonlyMap<string, ImportedSvg>;
  readonly removedContourCount: number;
};

type CandidateObject = ImportedSvg | ShapeObject | TextObject;

type ObjectContour = {
  readonly pathIndex: number;
  readonly contourIndex: number;
  readonly key: string;
  readonly comparable: ComparableContour | null;
};

export function planDeleteDuplicates(
  objects: ReadonlyArray<SceneObject>,
  options: DeleteDuplicatesOptions = {},
): DeleteDuplicatesPlan {
  const toleranceMm = options.toleranceMm ?? DUPLICATE_TOLERANCE_MM;
  const keepIds = options.keepIds ?? new Set<string>();
  const index = createContourIndex(toleranceMm);
  const removedObjectIds = new Set<string>();
  const editedObjects = new Map<string, ImportedSvg>();
  let removedContourCount = 0;
  const ordered = [
    ...objects.filter((object) => keepIds.has(object.id)),
    ...objects.filter((object) => !keepIds.has(object.id)),
  ];
  for (const object of ordered) {
    if (!isCandidate(object)) continue;
    const contours = objectContours(object, toleranceMm);
    const repeats = repeatedContours(contours, index, keepIds.has(object.id));
    if (repeats.size === 0) continue;
    if (repeats.size === contours.length) {
      removedObjectIds.add(object.id);
      removedContourCount += repeats.size;
    } else if (object.kind === 'imported-svg') {
      editedObjects.set(object.id, withoutContours(object, repeats));
      removedContourCount += repeats.size;
    }
  }
  return { removedObjectIds, editedObjects, removedContourCount };
}

// Keys of the contours that repeat one already indexed; the rest are indexed.
function repeatedContours(
  contours: ReadonlyArray<ObjectContour>,
  index: ContourIndex,
  keep: boolean,
): ReadonlySet<string> {
  const repeats = new Set<string>();
  for (const contour of contours) {
    if (contour.comparable === null) continue;
    if (!keep && index.hasMatch(contour.key, contour.comparable)) {
      repeats.add(contourKey(contour.pathIndex, contour.contourIndex));
    } else {
      index.add(contour.key, contour.comparable);
    }
  }
  return repeats;
}

function isCandidate(object: SceneObject): object is CandidateObject {
  return object.kind === 'imported-svg' || object.kind === 'shape' || object.kind === 'text';
}

function objectContours(object: CandidateObject, toleranceMm: number): ObjectContour[] {
  return object.paths.flatMap((path, pathIndex) => {
    const key = outputKey(object, path);
    return pathPolylines(object, path).map((polyline, contourIndex) => ({
      pathIndex,
      contourIndex,
      key,
      comparable:
        polyline === null
          ? null
          : comparableContour(
              polyline.points.map((point) => applyTransform(point, object.transform)),
              polyline.closed,
              toleranceMm,
            ),
    }));
  });
}

// One polyline per contour, in the order the contour is stored. A curve path
// that cannot be flattened keeps its slots so indexes still line up.
function pathPolylines(object: CandidateObject, path: ColoredPath): ReadonlyArray<Polyline | null> {
  if (path.curves === undefined) return path.polylines;
  const flattened = flattenColoredPathCurvesForTransform(path, object.transform, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  return flattened.kind === 'ok' ? flattened.polylines : path.curves.map(() => null);
}

// Contours only duplicate each other when they produce the same output.
function outputKey(object: CandidateObject, path: ColoredPath): string {
  const operationIds = path.operationIds ?? object.operationIds;
  return JSON.stringify([
    operationIds === undefined ? path.color.toLowerCase() : [...new Set(operationIds)].sort(),
    object.powerScale ?? null,
    object.operationOverride ?? null,
    path.strokeWidthMm ?? null,
  ]);
}

function withoutContours(object: ImportedSvg, repeats: ReadonlySet<string>): ImportedSvg {
  const paths: ColoredPath[] = [];
  const moved = new Map<string, readonly [number, number]>();
  object.paths.forEach((path, pathIndex) => {
    const count = path.curves?.length ?? path.polylines.length;
    const kept = [...Array(count).keys()].filter(
      (contourIndex) => !repeats.has(contourKey(pathIndex, contourIndex)),
    );
    if (kept.length === 0) return;
    kept.forEach((contourIndex, nextIndex) =>
      moved.set(contourKey(pathIndex, contourIndex), [paths.length, nextIndex]),
    );
    paths.push(keptContours(path, kept));
  });
  const anchors = object.cncTabAnchors?.flatMap((anchor) => {
    const target = moved.get(contourKey(anchor.pathIndex, anchor.polylineIndex));
    return target === undefined
      ? []
      : [{ ...anchor, pathIndex: target[0], polylineIndex: target[1] }];
  });
  return {
    ...object,
    paths,
    bounds: localBounds(paths) ?? object.bounds,
    ...(anchors === undefined ? {} : { cncTabAnchors: anchors }),
  };
}

function keptContours(path: ColoredPath, kept: ReadonlyArray<number>): ColoredPath {
  const keep = <T>(items: ReadonlyArray<T>): T[] =>
    kept.flatMap((index) => (items[index] === undefined ? [] : [items[index] as T]));
  if (path.curves === undefined) return { ...path, polylines: keep(path.polylines) };
  // Stored polylines are the curves' compatibility view, one per curve.
  const curves = keep(path.curves);
  return {
    ...path,
    curves,
    polylines:
      path.polylines.length === path.curves.length
        ? keep(path.polylines)
        : curves.map(curvePolyline),
  };
}

function curvePolyline(curve: CurveSubpath): Polyline {
  const flattened = flattenCurveSubpath(curve, {
    toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
    segmentBudget: Number.MAX_SAFE_INTEGER,
  });
  if (flattened.kind === 'ok') return flattened.polyline;
  return {
    closed: curve.closed,
    points: [curve.start, ...curve.segments.map((segment) => segment.to)],
  };
}

function localBounds(paths: ReadonlyArray<ColoredPath>): Bounds | null {
  const corners: Vec2[] = paths.flatMap((path) =>
    path.curves === undefined
      ? path.polylines.flatMap((polyline) => polyline.points)
      : path.curves.flatMap((curve) => {
          const box = curveSubpathBounds(curve);
          return [
            { x: box.minX, y: box.minY },
            { x: box.maxX, y: box.maxY },
          ];
        }),
  );
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of corners) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX) && Number.isFinite(minY) ? { minX, minY, maxX, maxY } : null;
}

function contourKey(pathIndex: number, contourIndex: number): string {
  return `${pathIndex}:${contourIndex}`;
}
