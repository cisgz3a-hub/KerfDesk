// create-rectangle — bridge from rectangle geometry to a kind:'shape'
// SceneObject (ADR-051, Phase G, B2): materialize the outline into a single
// ColoredPath, compute local bounds, and seed the transform. The drawing tool
// (B5) calls this on mouse-up; the round-trip / compile tests call it directly.
// Pure — no scene mutation, no I/O.

import {
  IDENTITY_TRANSFORM,
  type Bounds,
  type ColoredPath,
  type ShapeObject,
  type Transform,
} from '../scene';
import { rectangleToCurve, rectangleToPolylines, type RectangleSpec } from './rectangle';

export function createRectangle(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: RectangleSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = rectangleToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [
    { color: args.color, polylines, curves: [rectangleToCurve(args.spec)] },
  ];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'rect', ...args.spec },
    color: args.color,
    bounds: rectangleBounds(args.spec),
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}

function rectangleBounds(spec: RectangleSpec): Bounds {
  return { minX: 0, minY: 0, maxX: Math.max(0, spec.widthMm), maxY: Math.max(0, spec.heightMm) };
}
