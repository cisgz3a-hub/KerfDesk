// Cut in directional order (LightBurn "Order by direction"): within a Line
// operation, shapes run in a sweep across the bed, top to bottom, bottom to
// top, left to right or right to left as the operator sees the workspace, so
// a sheet is cut away from the side the parts fall or the smoke blows.
// Inside-first still holds: deeper contours go first, and the sweep orders
// shapes at the same depth. Open paths are entered from the end nearer the
// head when reversing is allowed. Deterministic: ties keep source order.

import type { Origin } from '../devices';
import type { Vec2 } from '../scene';
import { containmentDepths } from './containment-depth';
import { reverseCutSegment } from './cut-arc-moves';
import type { CutSegment } from './job';
import { polylineBounds } from './segment-bounds';

export type CutDirection = 'top-to-bottom' | 'bottom-to-top' | 'left-to-right' | 'right-to-left';

export const CUT_DIRECTIONS: ReadonlyArray<CutDirection> = [
  'top-to-bottom',
  'bottom-to-top',
  'left-to-right',
  'right-to-left',
];

/**
 * The sort key that puts a segment earlier in the sweep, in machine
 * coordinates. The workspace top is the back of the bed: larger machine Y on
 * front and centre origins, smaller on rear ones; right-hand origins mirror X.
 */
function sweepKey(direction: CutDirection, origin: Origin): (segment: CutSegment) => number {
  const yUp = !origin.startsWith('rear');
  const xRight = !origin.endsWith('right');
  return (segment) => {
    const box = polylineBounds(segment.polyline) ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    switch (direction) {
      case 'top-to-bottom':
        return yUp ? -box.maxY : box.minY;
      case 'bottom-to-top':
        return yUp ? box.minY : -box.maxY;
      case 'left-to-right':
        return xRight ? box.minX : -box.maxX;
      case 'right-to-left':
        return xRight ? -box.maxX : box.minX;
    }
  };
}

export function directionalSegmentOrder<T extends CutSegment>(
  segments: ReadonlyArray<T>,
  options: {
    readonly direction: CutDirection;
    readonly origin: Origin;
    readonly insideFirst: boolean;
    readonly allowsReverse: boolean;
  },
): T[] {
  const key = sweepKey(options.direction, options.origin);
  const depths = options.insideFirst ? containmentDepths(segments) : null;
  const order = segments
    .map((segment, index) => ({ segment, index, depth: depths?.[index] ?? 0, key: key(segment) }))
    .sort((a, b) => b.depth - a.depth || a.key - b.key || a.index - b.index);
  let cursor: Vec2 | null = null;
  return order.map(({ segment }) => {
    const first = segment.polyline[0] as Vec2;
    const last = segment.polyline[segment.polyline.length - 1] as Vec2;
    const flip =
      options.allowsReverse &&
      !segment.closed &&
      cursor !== null &&
      Math.hypot(last.x - cursor.x, last.y - cursor.y) <
        Math.hypot(first.x - cursor.x, first.y - cursor.y);
    const entered = flip ? reverseCutSegment(segment) : segment;
    cursor = entered.polyline[entered.polyline.length - 1] ?? cursor;
    return entered;
  });
}
