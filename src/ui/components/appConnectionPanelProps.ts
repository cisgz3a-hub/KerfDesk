import { type ConnectionPanelProps } from './ConnectionPanel';
import { type AABB } from '../../core/types';

export function buildAppConnectionPanelProps(props: ConnectionPanelProps): ConnectionPanelProps {
  return props;
}

type ConnectionPanelBoundsProps = Pick<
  ConnectionPanelProps,
  | 'boundsMinX'
  | 'boundsMinY'
  | 'boundsMaxX'
  | 'boundsMaxY'
  | 'frameTransformBoundsMinX'
  | 'frameTransformBoundsMinY'
  | 'frameTransformBoundsMaxX'
  | 'frameTransformBoundsMaxY'
>;

function finiteOrFallback(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * T2-6 Phase 3ap: keep the connection-panel bounds fallback policy out of
 * App.tsx's render prop object. App still chooses the source bounds; this
 * helper only normalizes non-finite values for the existing panel contract.
 */
export function resolveConnectionPanelBoundsProps(args: {
  sceneBounds: AABB;
  frameTransformBounds: AABB;
}): ConnectionPanelBoundsProps {
  return {
    boundsMinX: finiteOrFallback(args.sceneBounds.minX, 0),
    boundsMinY: finiteOrFallback(args.sceneBounds.minY, 0),
    boundsMaxX: finiteOrFallback(args.sceneBounds.maxX, 100),
    boundsMaxY: finiteOrFallback(args.sceneBounds.maxY, 100),
    frameTransformBoundsMinX: finiteOrFallback(args.frameTransformBounds.minX, 0),
    frameTransformBoundsMinY: finiteOrFallback(args.frameTransformBounds.minY, 0),
    frameTransformBoundsMaxX: finiteOrFallback(args.frameTransformBounds.maxX, 100),
    frameTransformBoundsMaxY: finiteOrFallback(args.frameTransformBounds.maxY, 100),
  };
}
