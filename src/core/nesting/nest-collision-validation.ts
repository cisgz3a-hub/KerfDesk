import { ContourBoxIndex } from '../trace/contour-box-index';
import { collides, inside, rectanglesOverlap, type PlacedState } from './nest-outline-geometry';
import type { NestRect } from './quick-nest';

/** The index only excludes disjoint boxes; the existing collision predicates decide. */
export function nestRectanglesAreClear(
  bin: NestRect,
  rectangles: ReadonlyArray<NestRect>,
  obstacles: ReadonlyArray<NestRect>,
): boolean {
  if (rectangles.some((rect) => !inside(bin, rect))) return false;
  const candidates = collisionCandidates([...rectangles, ...obstacles], (rect) => rect);
  return rectangles.every(
    (rect, index) =>
      !candidates(rect).some(
        (other) => other.index > index && rectanglesOverlap(rect, other.value),
      ),
  );
}

export function nestOutlinesAreClear(
  states: ReadonlyArray<PlacedState>,
  obstacles: ReadonlyArray<PlacedState>,
): boolean {
  const candidates = collisionCandidates([...states, ...obstacles], (state) => state.bounds);
  // Keep both directed polygon checks, including their unchanged clearance and
  // rounding semantics. Obstacle/obstacle intersections never invalidate a nest.
  return states.every(
    (state, index) =>
      !collides(
        state,
        candidates(state.bounds)
          .filter((other) => other.index !== index)
          .map((other) => other.value),
        [],
      ),
  );
}

type IndexedBounds<T> = NestRect & { readonly index: number; readonly value: T };

function collisionCandidates<T>(
  values: ReadonlyArray<T>,
  boundsOf: (value: T) => NestRect,
): (bounds: NestRect) => ReadonlyArray<IndexedBounds<T>> {
  const finite: IndexedBounds<T>[] = [];
  const unindexed: IndexedBounds<T>[] = [];
  values.forEach((value, index) => {
    const bounds = { ...boundsOf(value), index, value };
    // Finite input coordinates plus padding can overflow at the numeric limits.
    // Keep those boxes on the exact path instead of poisoning the finite tree.
    const target = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].every(Number.isFinite)
      ? finite
      : unindexed;
    target.push(bounds);
  });
  const tree = ContourBoxIndex.create(finite);
  return (bounds) => {
    const nearby = tree.query(bounds);
    return unindexed.length === 0 ? nearby : nearby.concat(unindexed);
  };
}
