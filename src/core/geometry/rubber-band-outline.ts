// rubber-band-outline — the tightest convex outline around a selection, as if
// a rubber band were stretched around it (LightBurn's Tools → Rubber Band
// Outline, ADR-377). Vector artwork contributes every point of its flattened
// contours; images and other objects without paths contribute the corners of
// their placed box, so a rotated photo is wrapped by its rotated edges.

import { err, ok, type Result } from '../result';
import {
  applyTransform,
  DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
  IDENTITY_TRANSFORM,
  type ImportedSvg,
  type SceneObject,
  type Vec2,
} from '../scene';
import { flattenColoredPathCurvesForTransform } from '../scene/curve-path';
import { convexHull } from './convex-hull';
import { boundsForPaths, type VectorOpError } from './vector-path-tools';

// Below this area (mm²) the band would be a line, which has nothing to wrap.
const MIN_OUTLINE_AREA_MM2 = 1e-4;

/** A closed outline in world space with an identity transform. */
export function rubberBandOutline(
  objects: ReadonlyArray<SceneObject>,
  id: string,
  color: string,
): Result<ImportedSvg, VectorOpError> {
  if (objects.length === 0) {
    return err({ kind: 'too-few-objects', message: 'Select artwork to wrap in an outline.' });
  }
  const hull = convexHull(objects.flatMap(outlinePoints));
  if (hull.length < 3 || polygonArea(hull) < MIN_OUTLINE_AREA_MM2) {
    return err({
      kind: 'empty-result',
      message: 'The selection is a single line or point, so there is no area to wrap.',
    });
  }
  const paths = [{ color, polylines: [{ closed: true, points: [...hull] }] }];
  const bounds = boundsForPaths(paths);
  if (bounds === null) {
    return err({ kind: 'empty-result', message: 'The selection has no area to wrap.' });
  }
  return ok({
    kind: 'imported-svg',
    id,
    source: 'Rubber-band outline',
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  });
}

function outlinePoints(object: SceneObject): ReadonlyArray<Vec2> {
  if (!('paths' in object) || object.paths.length === 0) return boxCorners(object);
  return object.paths.flatMap((path) => {
    const flattened = flattenColoredPathCurvesForTransform(path, object.transform, {
      toleranceMm: DEFAULT_MACHINE_CURVE_TOLERANCE_MM,
      segmentBudget: Number.MAX_SAFE_INTEGER,
    });
    // A curve too large to flatten still bounds the artwork by its box.
    if (flattened.kind !== 'ok') return boxCorners(object);
    return flattened.polylines.flatMap((polyline) =>
      polyline.points.map((point) => applyTransform(point, object.transform)),
    );
  });
}

function boxCorners(object: SceneObject): ReadonlyArray<Vec2> {
  const { minX, minY, maxX, maxY } = object.bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => applyTransform(corner, object.transform));
}

function polygonArea(points: ReadonlyArray<Vec2>): number {
  let twice = 0;
  for (const [index, point] of points.entries()) {
    const next = points[(index + 1) % points.length];
    if (next !== undefined) twice += point.x * next.y - next.x * point.y;
  }
  return Math.abs(twice) / 2;
}
