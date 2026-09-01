import type { Bounds, ColoredPath, ShapeObject } from '../../core/scene';
import { materializedPolylineToSpecPoints } from './path-node-edit-geometry';

/**
 * Synchronizes the one-path/one-subpath representation owned by a parametric polyline shape.
 * Accepted legacy shapes with ambiguous extra paths or subpaths return null instead of recording split truth.
 */
export function synchronizePolylineShapeGeometry(
  object: ShapeObject,
  paths: ReadonlyArray<ColoredPath>,
  bounds: Bounds,
): ShapeObject | null {
  if (object.spec.kind !== 'polyline') return null;
  const path = paths[0];
  const polyline = path?.polylines[0];
  if (
    paths.length !== 1 ||
    path?.polylines.length !== 1 ||
    (path.curves !== undefined && path.curves.length !== 1) ||
    polyline === undefined
  ) {
    return null;
  }
  return {
    ...object,
    paths,
    bounds,
    spec: {
      ...object.spec,
      points: materializedPolylineToSpecPoints(polyline.points, polyline.closed),
      closed: polyline.closed,
    },
  };
}
