import { IDENTITY_TRANSFORM, type ShapeObject, type Transform } from '../../scene';
import { outlineGeometry } from './bulge-outline';
import { starToPolylines, type StarSpec } from './star';

export function createStar(args: {
  readonly id: string;
  readonly color: string;
  readonly spec: StarSpec;
  readonly transform?: Transform;
}): ShapeObject {
  const { paths, bounds } = outlineGeometry(
    args.color,
    starToPolylines(args.spec),
    args.spec.bulge,
  );
  return {
    kind: 'shape',
    id: args.id,
    spec: { kind: 'star', ...args.spec },
    color: args.color,
    bounds,
    transform: args.transform ?? IDENTITY_TRANSFORM,
    paths,
  };
}
