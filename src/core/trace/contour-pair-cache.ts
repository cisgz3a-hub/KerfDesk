import { boxesOverlap, finiteContourBox, type ContourBox } from './contour-bounds';
import { ContourBoxIndex } from './contour-box-index';
import { visitContourBoxPairsSteps } from './contour-spatial';
import type { TraceSteps } from './trace-steps';

type IndexedBox = ContourBox & { readonly index: number };
type Base = {
  readonly keys: ReadonlyArray<unknown>;
  readonly index: ContourBoxIndex<IndexedBox>;
  /** Overlapping index pairs, flattened: [i0, j0, i1, j1, …] with i < j. */
  readonly pairs: Int32Array;
  /** A caller's verdict per measured pair (see recall). */
  readonly verdicts: unknown[];
};

/** One overlapping pair. `slot` names a pair whose boxes are both unchanged
 *  since the measured round (-1 otherwise): its verdict may be recalled. */
export type BoxPair<T> = { readonly first: T; readonly second: T; readonly slot: number };

// A round that changes more boxes than this re-measures every pair.
const MIN_REBUILD_CHANGES = 32;
const REBUILD_CHANGE_FRACTION = 8;
const CHECKPOINT_PAIRS = 256;
const NO_SLOT = -1;

/**
 * The overlapping (inclusive) pairs of a list of boxes that a topology repair
 * asks for once per round, when each round changes only a few of the boxes.
 * A box is identified across rounds by its key: an unchanged key must mean
 * an unchanged box and unchanged contents. The first round measures every
 * pair and keeps a spatial index; later rounds keep the pairs of unchanged
 * boxes and query the index for the changed ones only. A pair of unchanged
 * boxes also keeps the verdict its caller remembered for it, since the
 * caller's inputs are the same. Pairs come back in no particular order,
 * which the callers do not observe (they collect the boxes involved).
 */
export class ContourPairCache {
  private base: Base | null = null;

  *pairsSteps<T extends ContourBox>(
    boxes: ReadonlyArray<T>,
    keyOf: (box: T) => unknown,
  ): TraceSteps<Array<BoxPair<T>>> {
    const cooperate = yield;
    const keys = boxes.map(keyOf);
    const changed = this.changedSince(keys);
    if (changed === null) return yield* this.measureAllSteps(boxes, keys);
    const base = this.base as Base;
    const unchanged = (i: number): boolean => keys[i] === base.keys[i];
    const out: Array<BoxPair<T>> = [];
    const pair = (i: number, j: number, slot: number): BoxPair<T> => ({
      first: boxes[i] as T,
      second: boxes[j] as T,
      slot,
    });
    for (let p = 0; p < base.pairs.length; p += 2) {
      if (cooperate && p % (2 * CHECKPOINT_PAIRS) === 0) yield;
      const i = base.pairs[p] as number;
      const j = base.pairs[p + 1] as number;
      if (unchanged(i) && unchanged(j)) out.push(pair(i, j, p / 2));
    }
    if (cooperate) yield;
    for (const [i, j] of changedPairs(boxes, changed, base.index, unchanged)) {
      out.push(pair(i, j, NO_SLOT));
    }
    return out;
  }

  /** The verdict remembered for a slot, or undefined. */
  recall(slot: number): unknown {
    return slot === NO_SLOT ? undefined : this.base?.verdicts[slot];
  }

  remember(slot: number, verdict: unknown): void {
    if (slot !== NO_SLOT && this.base !== null) this.base.verdicts[slot] = verdict;
  }

  // Indices whose key moved since the measured round, ascending; null when
  // every pair must be measured again.
  private changedSince(keys: ReadonlyArray<unknown>): number[] | null {
    const base = this.base;
    if (base === null || base.keys.length !== keys.length) return null;
    const changed: number[] = [];
    const limit = Math.max(MIN_REBUILD_CHANGES, keys.length / REBUILD_CHANGE_FRACTION);
    for (let i = 0; i < keys.length; i += 1) {
      if (keys[i] === base.keys[i]) continue;
      changed.push(i);
      if (changed.length > limit) return null;
    }
    return changed;
  }

  private *measureAllSteps<T extends ContourBox>(
    boxes: ReadonlyArray<T>,
    keys: ReadonlyArray<unknown>,
  ): TraceSteps<Array<BoxPair<T>>> {
    yield;
    const out: Array<BoxPair<T>> = [];
    if (!boxes.every(finiteContourBox)) {
      // Unbounded boxes keep the plain sweep and are not cached.
      this.base = null;
      yield* visitContourBoxPairsSteps(boxes, (first, second) =>
        out.push({ first, second, slot: NO_SLOT }),
      );
      return out;
    }
    const indexed = boxes.map(
      (box, index): IndexedBox => ({
        minX: box.minX,
        minY: box.minY,
        maxX: box.maxX,
        maxY: box.maxY,
        index,
      }),
    );
    const index = yield* ContourBoxIndex.createSteps(indexed);
    const pairs: number[] = [];
    for (const entry of indexed) {
      for (const hit of index.query(entry)) {
        if (hit.index <= entry.index) continue;
        out.push({
          first: boxes[entry.index] as T,
          second: boxes[hit.index] as T,
          slot: pairs.length / 2,
        });
        pairs.push(entry.index, hit.index);
      }
    }
    this.base = { keys, index, pairs: Int32Array.from(pairs), verdicts: [] };
    return out;
  }
}

// The overlapping pairs with at least one changed box, as [i, j] with i < j:
// changed boxes against the unchanged ones the index holds, then against
// each other.
function changedPairs(
  boxes: ReadonlyArray<ContourBox>,
  changed: ReadonlyArray<number>,
  index: ContourBoxIndex<IndexedBox>,
  unchanged: (i: number) => boolean,
): Array<readonly [number, number]> {
  const pairs: Array<readonly [number, number]> = [];
  for (const c of changed) {
    const box = boxes[c] as ContourBox;
    for (const hit of index.query(box)) {
      const j = hit.index;
      if (!unchanged(j) || !boxesOverlap(box, boxes[j] as ContourBox)) continue;
      pairs.push(j < c ? [j, c] : [c, j]);
    }
  }
  for (let a = 0; a < changed.length; a += 1) {
    for (let b = a + 1; b < changed.length; b += 1) {
      const i = changed[a] as number;
      const j = changed[b] as number;
      if (boxesOverlap(boxes[i] as ContourBox, boxes[j] as ContourBox)) pairs.push([i, j]);
    }
  }
  return pairs;
}
