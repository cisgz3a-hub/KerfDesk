// Create Rubber-Band Outline (LightBurn gap LBG-T07, ADR-480): one closed
// shape around everything selected, as if a rubber band were stretched around
// it (the convex hull). Vector artwork and text contribute their real outlines
// in world space; images and reliefs contribute their four transformed corners.

import {
  applyTransform,
  IDENTITY_TRANSFORM,
  type ColoredPath,
  type ImportedSvg,
  type SceneObject,
  type Vec2,
} from '../scene';
import { convexHull } from './convex-hull';
import { boundsForPaths, isVectorPathObject, materializeVectorObject } from './vector-path-tools';

export const RUBBER_BAND_OUTLINE_SOURCE = 'Rubber-band outline';

// A hull narrower than this is a line, not a shape: nothing to cut around. A
// width, not an area, so a tiny square and a long sliver are judged alike
// (tools audit T34-P3-2, ADR-480 Amendment 7).
export const MIN_OUTLINE_WIDTH_MM = 0.01;

/** The outline as a new object with its own id, or null when the selection has no width. */
export function rubberBandOutline(
  objects: ReadonlyArray<SceneObject>,
  id: string,
): ImportedSvg | null {
  const hull = convexHull(objects.flatMap(worldOutlinePoints));
  if (hull.length < 3) return null;
  if (convexPolygonWidthMm(hull) < MIN_OUTLINE_WIDTH_MM) return null;
  // Closed polylines repeat their first point, so the canvas strokes every side.
  const outline = { closed: true, points: [...hull, ...hull.slice(0, 1)] };
  const paths: ColoredPath[] = [{ color: '#000000', polylines: [outline] }];
  const bounds = boundsForPaths(paths);
  if (bounds === null) return null;
  return {
    kind: 'imported-svg',
    id,
    source: RUBBER_BAND_OUTLINE_SOURCE,
    bounds,
    transform: IDENTITY_TRANSFORM,
    paths,
  };
}

/** The narrowest gap between two parallel lines that hold a convex polygon. */
export function convexPolygonWidthMm(hull: ReadonlyArray<Vec2>): number {
  let width = Infinity;
  hull.forEach((from, index) => {
    const to = hull[(index + 1) % hull.length] ?? from;
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length === 0) return;
    // A convex polygon's width is set by one of its edges and the vertex farthest from it.
    let farthest = 0;
    for (const point of hull) {
      const cross = (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
      farthest = Math.max(farthest, Math.abs(cross) / length);
    }
    width = Math.min(width, farthest);
  });
  return width === Infinity ? 0 : width;
}

/** Every point of an object's outline in world space; the four corners for an image or relief. */
export function worldOutlinePoints(object: SceneObject): ReadonlyArray<Vec2> {
  if (isVectorPathObject(object)) {
    return materializeVectorObject(object).paths.flatMap((path) =>
      path.polylines.flatMap((polyline) => polyline.points),
    );
  }
  const { minX, minY, maxX, maxY } = object.bounds;
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ].map((corner) => applyTransform(corner, object.transform));
}
