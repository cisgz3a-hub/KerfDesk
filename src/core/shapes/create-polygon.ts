// create-polygon — bridge from polygon geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B3). Unlike rect/ellipse, a regular polygon's bounding box
// depends on side count + orientation, so bounds are derived from the vertices.

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type Polyline,
  type ShapeObject,
  type Transform,
} from '../scene';
import { polygonToPolylines, type PolygonSpec } from './polygon';

export function createPolygon(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: PolygonSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = polygonToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [{ color: args.color, polylines }];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'polygon', ...args.spec },
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
