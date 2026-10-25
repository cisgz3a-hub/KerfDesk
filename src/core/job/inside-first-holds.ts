// Inside-first, part by part (ADR-669). Each item knows which shallower items
// it holds back: a closed container is ready to cut once no deeper item whose
// bounds lie inside its bounds is still waiting. A planner then chooses among
// ready items only, so a part's holes go just before the part's outline
// instead of every hole on the sheet going before any outline.
//
// WHY BOUNDS AND DEPTH, NOT PARENTS: depth-major order guaranteed "contained
// before container" exactly when containment means strictly deeper. Anything
// truly inside a contour is strictly deeper and has its bounds inside the
// contour's, so it holds that contour here too: every precedence depth-major
// kept is kept. A deeper shape that only sits in a container's bounds (in the
// notch of a C) merely delays it. Carried trace forests (ADR-531) give depths
// but no parents, which this needs no more than depth-major did.
//
// NO DEADLOCK: only strictly deeper items hold, so the deepest waiting item is
// always ready.

import { ContourBoxIndex } from '../trace/contour-box-index';
import { boundsContains, type SegmentBounds } from './segment-bounds';

export type HoldItem = {
  readonly depth: number;
  /** The box this item encloses when it holds others back; null never holds. */
  readonly container: SegmentBounds | null;
  /** Boxes of what this item cuts; any one inside a shallower container's box holds it. */
  readonly members: ReadonlyArray<SegmentBounds | null>;
};

export type InsideFirstHolds = {
  /** holds[x]: the items x must be cut before, ascending. */
  readonly holds: ReadonlyArray<ReadonlyArray<number>>;
  /** heldBy[c]: the items c must be cut after, ascending. */
  readonly heldBy: ReadonlyArray<ReadonlyArray<number>>;
  readonly any: boolean;
};

export function insideFirstHolds(items: ReadonlyArray<HoldItem>): InsideFirstHolds {
  const holds: number[][] = items.map(() => []);
  const heldBy: number[][] = items.map(() => []);
  const boxes = items.flatMap((item, index) =>
    item.container !== null && finiteBounds(item.container) ? [{ ...item.container, index }] : [],
  );
  if (boxes.length === 0) return { holds, heldBy, any: false };
  const index = ContourBoxIndex.create(boxes);
  let any = false;
  items.forEach((_, target) => {
    const list = containersHeldBy(items, index, target);
    if (list.length === 0) return;
    any = true;
    holds[target] = list;
    for (const container of list) heldBy[container]?.push(target);
  });
  // Targets are visited in ascending order, so every heldBy list is ascending.
  return { holds, heldBy, any };
}

type IndexedBox = SegmentBounds & { readonly index: number };

// The shallower containers whose box holds one of `target`'s member boxes, ascending.
function containersHeldBy(
  items: ReadonlyArray<HoldItem>,
  index: ContourBoxIndex<IndexedBox>,
  target: number,
): number[] {
  const item = items[target] as HoldItem;
  const found = new Set<number>();
  for (const member of item.members) {
    if (member === null || !finiteBounds(member)) continue;
    for (const candidate of index.query(member)) {
      const container = candidate.index;
      if (container === target || (items[container]?.depth ?? 0) >= item.depth) continue;
      if (boundsContains(candidate, member)) found.add(container);
    }
  }
  return [...found].sort((a, b) => a - b);
}

/** A fresh count, per item, of the items still holding it back. */
export function waitingCounts(holds: InsideFirstHolds): Int32Array {
  return Int32Array.from(holds.heldBy, (list) => list.length);
}

/** Retires `placed`, releasing what it held; calls `released` for each item now ready. */
export function releaseHolds(
  holds: InsideFirstHolds,
  waiting: Int32Array,
  placed: number,
  released?: (item: number) => void,
): void {
  for (const container of holds.holds[placed] ?? []) {
    const left = (waiting[container] ?? 0) - 1;
    waiting[container] = left;
    if (left === 0) released?.(container);
  }
}

function finiteBounds(box: SegmentBounds): boolean {
  return (
    Number.isFinite(box.minX) &&
    Number.isFinite(box.minY) &&
    Number.isFinite(box.maxX) &&
    Number.isFinite(box.maxY)
  );
}
