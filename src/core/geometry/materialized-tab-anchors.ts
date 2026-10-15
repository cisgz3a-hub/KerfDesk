import { cncTabAnchorPosition, projectPointToPolyline } from '../cnc/cnc-tab-anchors';
import type { CncTabAnchor, ColoredPath, SceneObject } from '../scene';
import type { VectorSceneObject } from './vector-path-tools';

type Position = Pick<CncTabAnchor, 'pathIndex' | 'polylineIndex'>;

/** Preserve physical tab positions when a contour is baked into world coordinates. */
export function materializedTabAnchors(
  object: VectorSceneObject,
  paths: ReadonlyArray<ColoredPath>,
  locate: (anchor: CncTabAnchor) => Position | undefined = (anchor) => anchor,
): Pick<SceneObject, 'cncTabAnchors' | 'laserTabAnchors'> {
  if (object.cncTabAnchors === undefined && object.laserTabAnchors === undefined) return {};
  // Broken contours keep their anchors for a future straight closure (ADR-494
  // Amendment 1). Close this measurement copy, never the actual artwork.
  const closedSource = {
    ...object,
    paths: object.paths.map((path) => ({
      ...path,
      polylines: path.polylines.map((line) => ({ ...line, closed: true })),
      ...(path.curves === undefined
        ? {}
        : { curves: path.curves.map((curve) => ({ ...curve, closed: true })) }),
    })),
  };
  const remap = <A extends CncTabAnchor>(anchors: ReadonlyArray<A>): ReadonlyArray<A> =>
    anchors.flatMap((anchor) => {
      const position = locate(anchor);
      if (position === undefined) return [];
      const retained = { ...anchor, ...position };
      const point = cncTabAnchorPosition(closedSource, anchor);
      const line = paths[position.pathIndex]?.polylines[position.polylineIndex];
      if (point === null || line === undefined) return [retained];
      const projected = projectPointToPolyline({ ...line, closed: true }, point);
      return [projected === null ? retained : { ...retained, pathT: projected.pathT }];
    });
  return {
    ...(object.cncTabAnchors === undefined ? {} : { cncTabAnchors: remap(object.cncTabAnchors) }),
    ...(object.laserTabAnchors === undefined
      ? {}
      : { laserTabAnchors: remap(object.laserTabAnchors) }),
  };
}
