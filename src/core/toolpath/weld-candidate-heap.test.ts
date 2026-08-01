import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  popWeldCandidateHeap,
  pushWeldCandidateHeap,
  type WeldCandidateHeap,
} from './weld-candidate-heap';

const MIN_SORT_KEY = -1_000;
const MAX_SORT_KEY = 1_000;
const MAX_HEAP_VALUES = 200;
const PROPERTY_RUNS = 100;
const PROPERTY_SEED = 20_260_728;

type HeapEntry = {
  readonly priority: number;
  readonly tie: number;
  readonly id: number;
};

const HEAP_ENTRY_ARBITRARY = fc.record({
  priority: fc.integer({ min: MIN_SORT_KEY, max: MAX_SORT_KEY }),
  tie: fc.integer({ min: MIN_SORT_KEY, max: MAX_SORT_KEY }),
  id: fc.integer(),
});

describe('WeldCandidateHeap', () => {
  it('pops every unique entry in total comparator order', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(HEAP_ENTRY_ARBITRARY, {
          maxLength: MAX_HEAP_VALUES,
          selector: (entry) => entry.id,
        }),
        (entries) => {
          const heap = entries.reduce<WeldCandidateHeap<HeapEntry>>(
            (current, entry) => pushWeldCandidateHeap(current, entry, isEntryBefore),
            null,
          );
          expect(drainHeap(heap)).toEqual(entries.reduce(insertSorted, []));
        },
      ),
      { numRuns: PROPERTY_RUNS, seed: PROPERTY_SEED },
    );
  });

  it('retains earlier heap roots after later inserts and pops', () => {
    const later = { priority: 2, tie: 0, id: 2 };
    const earlier = { priority: 1, tie: 0, id: 1 };
    const firstRoot = pushWeldCandidateHeap(null, later, isEntryBefore);
    const secondRoot = pushWeldCandidateHeap(firstRoot, earlier, isEntryBefore);

    expect(popWeldCandidateHeap(firstRoot, isEntryBefore)?.value).toEqual(later);
    expect(popWeldCandidateHeap(secondRoot, isEntryBefore)?.value).toEqual(earlier);
    expect(popWeldCandidateHeap(firstRoot, isEntryBefore)?.value).toEqual(later);
  });
});

function isEntryBefore(left: HeapEntry, right: HeapEntry): boolean {
  return compareEntries(left, right) < 0;
}

function compareEntries(left: HeapEntry, right: HeapEntry): number {
  if (left.priority !== right.priority) return left.priority - right.priority;
  if (left.tie !== right.tie) return left.tie - right.tie;
  return left.id - right.id;
}

function drainHeap(initial: WeldCandidateHeap<HeapEntry>): ReadonlyArray<HeapEntry> {
  let heap = initial;
  let values: ReadonlyArray<HeapEntry> = [];
  for (;;) {
    const popped = popWeldCandidateHeap(heap, isEntryBefore);
    if (popped === null) return values;
    heap = popped.heap;
    values = [...values, popped.value];
  }
}

function insertSorted(
  sorted: ReadonlyArray<HeapEntry>,
  entry: HeapEntry,
): ReadonlyArray<HeapEntry> {
  const index = sorted.findIndex((candidate) => compareEntries(entry, candidate) < 0);
  return index < 0
    ? [...sorted, entry]
    : [...sorted.slice(0, index), entry, ...sorted.slice(index)];
}
