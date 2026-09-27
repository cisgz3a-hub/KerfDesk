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
import { signedAreaMm2 } from './polyline-orientation';
import { boundsForPaths, isVectorPathObject, materializeVectorObject } from './vector-path-tools';

export const RUBBER_BAND_OUTLINE_SOURCE = 'Rubber-band outline';

// A hull thinner than this is a line, not a shape: nothing to cut around.
const MIN_OUTLINE_AREA_MM2 = 1e-4;

/** The outline as a new object with its own id, or null when the selection has no area. */
export function rubberBandOutline(
  objects: ReadonlyArray<SceneObject>,
  id: string,
): ImportedSvg | null {
  const hull = convexHull(objects.flatMap(worldOutlinePoints));
  if (hull.length < 3) return null;
  if (Math.abs(signedAreaMm2(hull)) < MIN_OUTLINE_AREA_MM2) return null;
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
