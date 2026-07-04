// create-polyline — bridge from polyline geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B6). Like create-polygon, bounds derive from the vertex
// extents; the pen places absolute scene-mm points, so callers pass
// IDENTITY_TRANSFORM (the default) and local space equals scene space.

import { IDENTITY_TRANSFORM, type ColoredPath, type ShapeObject, type Transform } from '../scene';
import { polylineToPolylines, type PolylineSpec } from './polyline';
import { boundsOfPolylines } from './polyline-bounds';

export function createPolyline(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: PolylineSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = polylineToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [{ color: args.color, polylines }];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'polyline', ...args.spec },
    color: args.color,
    bounds: boundsOfPolylines(polylines),
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}
