// Cut in directional order (LightBurn "Order by direction"): within a Line
// operation, shapes run in a sweep across the bed, top to bottom, bottom to
// top, left to right or right to left as the operator sees the workspace, so
// a sheet is cut away from the side the parts fall or the smoke blows.
// Inside-first still holds, part by part (ADR-669): the sweep takes the next
// ready shape, and an outline is ready once the shapes inside it are cut, so
// the sheet is swept once rather than once per depth. Open paths are entered
// from the end nearer the head when reversing is allowed. Deterministic: ties
// keep source order.

import type { Origin } from '../devices';
import type { Vec2 } from '../scene';
import { reverseCutSegment } from './cut-arc-moves';
import { releaseHolds, waitingCounts, type InsideFirstHolds } from './inside-first-holds';
import type { CutSegment } from './job';
import { polylineBounds } from './segment-bounds';
import { segmentHolds } from './segment-order';

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
export function sweepKey(direction: CutDirection, origin: Origin): (segment: CutSegment) => number {
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
  const keys = segments.map(key);
  const holds = options.insideFirst ? segmentHolds(segments) : undefined;
  const order = sweepOrder(keys, holds).map((index) => segments[index] as T);
  let cursor: Vec2 | null = null;
  return order.map((segment) => {
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

/**
 * Indices in sweep order: the ready item with the least (key, index) next.
 * Without holds that is a plain sort by (key, index). Shared with the topology
 * packet planner.
 */
export function sweepOrder(
  keys: ReadonlyArray<number>,
  holds: InsideFirstHolds | undefined,
): number[] {
  const indices = keys.map((_, index) => index);
  const byKey = (a: number, b: number): number => (keys[a] ?? 0) - (keys[b] ?? 0) || a - b;
  if (holds === undefined || !holds.any) return indices.sort(byKey);
  const waiting = waitingCounts(holds);
  const ready = new MinHeap(byKey);
  for (const index of indices) if (waiting[index] === 0) ready.push(index);
  const out: number[] = [];
  for (let next = ready.pop(); next !== undefined; next = ready.pop()) {
    out.push(next);
    releaseHolds(holds, waiting, next, (released) => ready.push(released));
  }
  return out;
}

class MinHeap {
  private readonly items: number[] = [];
  constructor(private readonly compare: (a: number, b: number) => number) {}

  push(item: number): void {
    const items = this.items;
    items.push(item);
    let at = items.length - 1;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (this.compare(items[at] as number, items[parent] as number) >= 0) break;
      [items[at], items[parent]] = [items[parent] as number, items[at] as number];
      at = parent;
    }
  }

  pop(): number | undefined {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (top === undefined || last === undefined || items.length === 0) return top;
    items[0] = last;
    let at = 0;
    for (;;) {
      const left = 2 * at + 1;
      const right = left + 1;
      let least = at;
      if (left < items.length && this.compare(items[left] as number, items[least] as number) < 0)
        least = left;
      if (right < items.length && this.compare(items[right] as number, items[least] as number) < 0)
        least = right;
      if (least === at) return top;
      [items[at], items[least]] = [items[least] as number, items[at] as number];
      at = least;
    }
  }
}
