import type { SceneObject } from '../scene';

const MAX_SUBSETS_PER_SOURCE = 8;

// ADR-050: transparent identity memoization, GC-bounded with capped membership entries.
// Only immutable source-array identity and selected indexes affect this selection.
const subsets = new WeakMap<ReadonlyArray<SceneObject>, Map<string, ReadonlyArray<SceneObject>>>();

export function stableFillArtworkSubset(
  objects: ReadonlyArray<SceneObject>,
  members: ReadonlySet<SceneObject>,
): ReadonlyArray<SceneObject> {
  // Keep the ordinary all-Fill route's original array without allocating a copy.
  if (objects.every((object) => members.has(object))) return objects;
  const indexes: number[] = [];
  for (const [index, object] of objects.entries()) {
    if (members.has(object)) indexes.push(index);
  }
  const key = indexes.join(',');
  let byMembership = subsets.get(objects);
  if (byMembership === undefined) {
    byMembership = new Map();
    subsets.set(objects, byMembership);
  }
  const cached = byMembership.get(key);
  if (cached !== undefined) return cached;
  const selected = objects.filter((object) => members.has(object));
  if (byMembership.size >= MAX_SUBSETS_PER_SOURCE) {
    const oldestKey = byMembership.keys().next().value;
    if (oldestKey !== undefined) byMembership.delete(oldestKey);
  }
  byMembership.set(key, selected);
  return selected;
}
