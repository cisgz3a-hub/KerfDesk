// create-polygon — bridge from polygon geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B3). Unlike rect/ellipse, a regular polygon's bounding box
// depends on side count + orientation, so bounds are derived from the vertices.

import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type ShapeObject,
  type Transform,
} from '../../scene';
import { boundsOfPolylines } from '../polyline-bounds';
import { polygonToPolylines, type PolygonSpec } from './polygon';

export function createPolygon(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: PolygonSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = polygonToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [
    { color: args.color, polylines, curves: polylines.map(polylineToCurveSubpath) },
  ];
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
