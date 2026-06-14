// create-polyline — bridge from polyline geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B6). Like create-polygon, bounds derive from the vertex
// extents; the pen places absolute scene-mm points, so callers pass
// IDENTITY_TRANSFORM (the default) and local space equals scene space.

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type Polyline,
  type ShapeObject,
  type Transform,
} from '../scene';
import { polylineToPolylines, type PolylineSpec } from './polyline';

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

function boundsOfPolylines(polylines: ReadonlyArray<Polyline>): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const polyline of polylines) {
    for (const point of polyline.points) {
      xs.push(point.x);
      ys.push(point.y);
    }
  }
  if (xs.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
