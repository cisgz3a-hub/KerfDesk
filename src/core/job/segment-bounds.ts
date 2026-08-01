// Axis-aligned bounds for cut segments, shared by the travel optimizer's start
// cursor and its containment-depth index. Extracted so the two do not each
// carry their own copy of the same arithmetic.

import type { Vec2 } from '../scene';

export type SegmentBounds = {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
};

export function polylineBounds(polyline: ReadonlyArray<Vec2>): SegmentBounds | null {
  if (polyline.length === 0) return null;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of polyline) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

export function boundsContains(container: SegmentBounds, target: SegmentBounds): boolean {
  return (
    target.minX >= container.minX &&
    target.maxX <= container.maxX &&
    target.minY >= container.minY &&
    target.maxY <= container.maxY
  );
}

export function boundsCenter(bounds: SegmentBounds | null): Vec2 | null {
  if (bounds === null) return null;
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
