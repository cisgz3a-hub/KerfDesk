import { circularPlacements } from './array-circular-layout';
import { gridPlacements } from './array-grid-layout';
import { finite, positiveCount } from './array-layout-math';
import type { ArrayPlacement, ArraySpec, PointRotationArraySpec } from './array-layout-types';
import { assertNever, type Bounds } from './scene-object';

export type {
  ArrayMirrorAxes,
  ArrayPlacement,
  ArrayPlacementMirror,
  ArraySpec,
  CircularArcSpec,
  CircularArraySpec,
  GridArraySpec,
  PointRotationArraySpec,
} from './array-layout-types';

export function arrayPlacements(bounds: Bounds, spec: ArraySpec): ReadonlyArray<ArrayPlacement> {
  switch (spec.kind) {
    case 'grid':
      return gridPlacements(bounds, spec);
    case 'circular':
      return circularPlacements(bounds, spec);
    case 'point-rotation':
      return pointRotationPlacements(bounds, spec);
    default:
      return assertNever(spec, 'ArraySpec');
  }
}

/**
 * How many placements `arrayPlacements` makes for a spec, the original included,
 * without laying any of them out. It rounds exactly as the layouts do, so a count
 * no project could hold (1e12, 1e300) can be refused before anything is
 * allocated for it. A grid too large for a number to hold is Infinity.
 */
export function arrayPlacementCount(spec: ArraySpec): number {
  switch (spec.kind) {
    case 'grid':
      return positiveCount(spec.rows) * positiveCount(spec.columns);
    case 'circular':
    case 'point-rotation':
      return positiveCount(spec.count);
    default:
      return assertNever(spec, 'ArraySpec');
  }
}

function pointRotationPlacements(
  bounds: Bounds,
  spec: PointRotationArraySpec,
): ReadonlyArray<ArrayPlacement> {
  const count = positiveCount(spec.count);
  const pivot = {
    x: (finite(bounds.minX) + finite(bounds.maxX)) / 2,
    y: (finite(bounds.minY) + finite(bounds.maxY)) / 2,
  };
  const stepDeg = finite(spec.totalAngleDeg) / count;
  return Array.from({ length: count }, (_, index) => {
    const rotationDeg = index === 0 ? 0 : index * stepDeg;
    return {
      dx: 0,
      dy: 0,
      rotationDeg,
      ...(rotationDeg === 0 ? {} : { pivot }),
    };
  });
}
