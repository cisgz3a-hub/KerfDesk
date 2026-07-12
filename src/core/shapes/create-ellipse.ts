// create-ellipse — bridge from ellipse geometry to a kind:'shape' SceneObject
// (ADR-051, Phase G, B3). Bounds are the inscribing box [0,width] x [0,height].

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type ShapeObject,
  type Transform,
} from '../scene';
import { ellipseToCurve, ellipseToPolylines, type EllipseSpec } from './ellipse';

export function createEllipse(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: EllipseSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = ellipseToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [
    { color: args.color, polylines, curves: [ellipseToCurve(args.spec)] },
  ];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'ellipse', ...args.spec },
    color: args.color,
    bounds: ellipseBounds(args.spec),
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}

function ellipseBounds(spec: EllipseSpec): Bounds {
  return { minX: 0, minY: 0, maxX: Math.max(0, spec.widthMm), maxY: Math.max(0, spec.heightMm) };
}
