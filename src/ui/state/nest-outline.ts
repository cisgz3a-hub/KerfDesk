import type { PathsD } from 'clipper2-ts';
import { isVectorPathObject, materializeVectorObject } from '../../core/geometry';
import {
  normalizeVectorObjectRegion,
  unionNormalizedRegions,
} from '../../core/geometry/vector-path-regions';
import { tryVectorOp } from '../../core/geometry/vector-path-tools';
import type { NestOutline, NestRect } from '../../core/nesting';
import { IDENTITY_TRANSFORM, type ColoredPath, type SceneObject } from '../../core/scene';

const MAX_OUTLINE_POINTS_PER_UNIT = 20_000;

/** Keep each object's fill semantics before combining a rigid group's occupied
 * area. Raw opposite-winding objects must never subtract one another. */
export function outlineForNestUnit(
  objects: ReadonlyArray<SceneObject>,
  bounds: NestRect,
): { readonly outline?: NestOutline } {
  const regions: PathsD[] = [];
  let sourcePointCount = 0;
  for (const object of objects) {
    if (!isVectorPathObject(object)) return {};
    const materialized = tryVectorOp(() => materializeVectorObject(object));
    if (materialized.kind === 'error') return {};
    // Keep the existing source budget before doing polygon normalization; a
    // dense contour must not evade it merely because its union simplifies.
    const count = boundedClosedPointCount(
      materialized.value.paths,
      MAX_OUTLINE_POINTS_PER_UNIT - sourcePointCount,
    );
    if (count === null) return {};
    sourcePointCount += count;
    const region = normalizeVectorObjectRegion({
      ...object,
      // These paths are already flattened in scene coordinates. Retain the
      // original kind so text uses nonzero and ordinary artwork uses even-odd.
      paths: materialized.value.paths,
      bounds: materialized.value.bounds,
      transform: IDENTITY_TRANSFORM,
    });
    if (region.kind === 'error') return {};
    regions.push(region.value);
  }
  const occupied = unionNormalizedRegions(regions);
  if (occupied.kind === 'error' || occupied.value.length === 0) return {};
  const pointCount = occupied.value.reduce((total, path) => total + path.length, 0);
  if (pointCount > MAX_OUTLINE_POINTS_PER_UNIT) return {};
  return {
    outline: occupied.value.map((path) =>
      path.map((point) => ({ x: point.x - bounds.minX, y: point.y - bounds.minY })),
    ),
  };
}

function boundedClosedPointCount(
  paths: ReadonlyArray<ColoredPath>,
  remaining: number,
): number | null {
  let count = 0;
  for (const path of paths) {
    for (const polyline of path.polylines) {
      if (!polyline.closed || polyline.points.length < 3) return null;
      count += polyline.points.length;
      if (count > remaining) return null;
    }
  }
  return count;
}
