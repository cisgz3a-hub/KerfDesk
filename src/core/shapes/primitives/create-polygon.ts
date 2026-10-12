// create-polygon — bridge from polygon geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B3). Unlike rect/ellipse, a regular polygon's bounding box
// depends on side count + orientation, so bounds are derived from the vertices.

import { IDENTITY_TRANSFORM, type ShapeObject, type Transform } from '../../scene';
import { outlineGeometry } from './bulge-outline';
import { polygonToPolylines, type PolygonSpec } from './polygon';

export function createPolygon(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: PolygonSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const { paths, bounds } = outlineGeometry(
    args.color,
    polygonToPolylines(args.spec),
    args.spec.bulge,
  );
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'polygon', ...args.spec },
    color: args.color,
    bounds,
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}
