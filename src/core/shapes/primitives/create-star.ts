import {
  IDENTITY_TRANSFORM,
  polylineToCurveSubpath,
  type ColoredPath,
  type ShapeObject,
  type Transform,
} from '../../scene';
import { boundsOfPolylines } from '../polyline-bounds';
import { starToPolylines, type StarSpec } from './star';

export function createStar(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: StarSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const polylines = starToPolylines(args.spec);
  const paths: ReadonlyArray<ColoredPath> = [
    { color: args.color, polylines, curves: polylines.map(polylineToCurveSubpath) },
  ];
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'star', ...args.spec },
    color: args.color,
    bounds: boundsOfPolylines(polylines),
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}
