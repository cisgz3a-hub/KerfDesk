// Select Contained and Select Smaller Shapes (LightBurn gap LBG-F03, ADR-480).
// Both work on world geometry, so rotation, scale and mirroring count.
// https://docs.lightburnsoftware.com/latest/Reference/UI/EditMenu/

import {
  isClosedEnough,
  transformedBBox,
  type Bounds,
  type Polyline,
  type SceneObject,
  type Vec2,
} from '../scene';
import { worldOutlinePoints } from './rubber-band-outline';
import { segmentContainedInPolygon } from './segment-contained-in-polygon';
import { isClosedPolygon, isVectorPathObject, materializeVectorObject } from './vector-path-tools';

type Contour = { readonly points: ReadonlyArray<Vec2>; readonly bounds: Bounds };

/** The closed paths of the given objects, in world space. */
export function worldClosedContours(objects: ReadonlyArray<SceneObject>): ReadonlyArray<Contour> {
  return objects.flatMap((object) => {
    if (!isVectorPathObject(object)) return [];
    return materializeVectorObject(object)
      .paths.flatMap((path) => path.polylines)
      .filter(
        (polyline) =>
          polyline.points.length >= 3 && (isClosedPolygon(polyline) || isClosedEnough(polyline)),
      )
      .map((polyline) => ({ points: polyline.points, bounds: pointBounds(polyline.points) }));
  });
}

/**
 * Candidates whose every outline point lies inside one closed path of the
 * containers. A shape that straddles two containers is not contained by either.
 */
export function containedObjectIds(
  contours: ReadonlyArray<Contour>,
  candidates: ReadonlyArray<SceneObject>,
): ReadonlyArray<string> {
  return candidates
    .filter((candidate) => {
      const points = worldOutlinePoints(candidate);
      if (points.length === 0) return false;
      const bounds = pointBounds(points);
      const outlines: ReadonlyArray<Polyline> = isVectorPathObject(candidate)
        ? materializeVectorObject(candidate).paths.flatMap((path) => path.polylines)
        : [{ closed: true, points }];
      return contours.some(
        (contour) =>
          boundsInside(bounds, contour.bounds) &&
          outlines.every((outline) =>
            outline.points.every((point, index) => {
              const next =
                outline.points[index + 1] ?? (outline.closed ? outline.points[0] : point);
              return next !== undefined && segmentContainedInPolygon(point, next, contour.points);
            }),
          ),
      );
    })
    .map((candidate) => candidate.id);
}

/** Candidates no wider and no taller than the widest and tallest reference object. */
export function smallerObjectIds(
  references: ReadonlyArray<SceneObject>,
  candidates: ReadonlyArray<SceneObject>,
): ReadonlyArray<string> {
  const sizes = references.map((object) => boxSize(transformedBBox(object)));
  const maxWidth = Math.max(...sizes.map((size) => size.width));
  const maxHeight = Math.max(...sizes.map((size) => size.height));
  return candidates
    .filter((candidate) => {
      const size = boxSize(transformedBBox(candidate));
      return size.width <= maxWidth + SIZE_EPS_MM && size.height <= maxHeight + SIZE_EPS_MM;
    })
    .map((candidate) => candidate.id);
}

const SIZE_EPS_MM = 1e-6;

function boxSize(bounds: Bounds): { readonly width: number; readonly height: number } {
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

function boundsInside(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.minX >= outer.minX &&
    inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX &&
    inner.maxY <= outer.maxY
  );
}

function pointBounds(points: ReadonlyArray<Vec2>): Bounds {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}
