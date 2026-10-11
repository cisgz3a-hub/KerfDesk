import type { Bounds } from '../scene';
import { boundsOverlap } from './trim-contours';

type Bounded = { readonly bounds: Bounds };
export type TrimBoundsIndex<T extends Bounded> = {
  readonly bounds: Bounds;
} & (
  | { readonly entries: ReadonlyArray<T> }
  | { readonly children: ReadonlyArray<TrimBoundsIndex<T>> }
);

/** A balanced canonical-bounds tree; long segments never expand into grid cells. */
export function createTrimBoundsIndex<T extends Bounded>(
  entries: ReadonlyArray<T>,
): TrimBoundsIndex<T> | null {
  // NaN boxes never passed the original overlap test; do not let one poison a whole tree.
  return buildIndex(entries.filter((entry) => !Object.values(entry.bounds).some(Number.isNaN)));
}

function buildIndex<T extends Bounded>(entries: ReadonlyArray<T>): TrimBoundsIndex<T> | null {
  if (entries.length === 0) return null;
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const entry of entries) {
    bounds.minX = Math.min(bounds.minX, entry.bounds.minX);
    bounds.minY = Math.min(bounds.minY, entry.bounds.minY);
    bounds.maxX = Math.max(bounds.maxX, entry.bounds.maxX);
    bounds.maxY = Math.max(bounds.maxY, entry.bounds.maxY);
  }
  if (entries.length <= 8) return { bounds, entries };
  const horizontal = bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY;
  const center = (entry: T): number =>
    horizontal
      ? entry.bounds.minX / 2 + entry.bounds.maxX / 2
      : entry.bounds.minY / 2 + entry.bounds.maxY / 2;
  const sorted = [...entries].sort((a, b) => center(a) - center(b));
  const middle = sorted.length >> 1;
  const children = [buildIndex(sorted.slice(0, middle)), buildIndex(sorted.slice(middle))].filter(
    (child): child is TrimBoundsIndex<T> => child !== null,
  );
  return { bounds, children };
}

export function forEachTrimBoundsOverlap<T extends Bounded>(
  index: TrimBoundsIndex<T> | null,
  bounds: Bounds,
  margin: number,
  visit: (entry: T) => void,
): void {
  if (index === null || !boundsOverlap(index.bounds, bounds, margin)) return;
  if ('entries' in index) {
    for (const entry of index.entries) {
      if (boundsOverlap(entry.bounds, bounds, margin)) visit(entry);
    }
  } else {
    for (const child of index.children) forEachTrimBoundsOverlap(child, bounds, margin, visit);
  }
}
