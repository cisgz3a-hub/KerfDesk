// Degree-two junctions waiting to dissolve, in the order spur pruning has
// always visited them: the insertion order of a fresh liveDegrees(chains)
// map. That map inserts each live open chain's `a` then `b`, in chain order,
// so a node sits at its first incidence — chain rank × 2, plus 1 when it
// first appears as a `b`. Rebuilding the map for every dissolution made
// pruning quadratic in the chain count; this queue keeps one entry per
// changed node instead and re-checks an entry's position when it surfaces.

import type { MutablePruneChain } from './pruning-worklist';

type Entry = { readonly at: number; readonly node: number };

export class PassthroughQueue {
  private readonly heap: Entry[] = [];

  /** `positionOf`: the node's current first-incidence position, or
   *  Infinity when it is no longer a live degree-two junction. */
  constructor(private readonly positionOf: (node: number) => number) {}

  /** Queue a node whose incident chains or degree changed. */
  touch(node: number): void {
    const at = this.positionOf(node);
    if (at !== Infinity) this.push({ at, node });
  }

  /** Remove and return the earliest live candidate, or undefined. */
  take(): number | undefined {
    for (let entry = this.pop(); entry !== undefined; entry = this.pop()) {
      // An entry whose position moved was re-queued when it moved.
      if (this.positionOf(entry.node) === entry.at) return entry.node;
    }
    return undefined;
  }

  private push(entry: Entry): void {
    const heap = this.heap;
    let child = heap.length;
    heap.push(entry);
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const above = heap[parent] as Entry;
      if (above.at <= entry.at) break;
      heap[child] = above;
      child = parent;
    }
    heap[child] = entry;
  }

  private pop(): Entry | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child =
        right < heap.length && (heap[right] as Entry).at < (heap[left] as Entry).at ? right : left;
      if ((heap[child] as Entry).at >= last.at) break;
      heap[parent] = heap[child] as Entry;
      parent = child;
    }
    heap[parent] = last;
    return top;
  }
}

/** A node's first-incidence position among `incident` chains. */
export function firstIncidence(
  node: number,
  incident: Iterable<MutablePruneChain>,
  rank: ReadonlyMap<MutablePruneChain, number>,
): number {
  let at = Infinity;
  for (const chain of incident) {
    const position = (rank.get(chain) ?? 0) * 2;
    at = Math.min(at, chain.a === node ? position : position + 1);
  }
  return at;
}
