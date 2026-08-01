type WeldCandidateHeapNode<Value> = {
  readonly value: Value;
  readonly left: WeldCandidateHeap<Value>;
  readonly right: WeldCandidateHeap<Value>;
  readonly rank: number;
};

/** Immutable leftist heap used for deterministic weld candidates. */
export type WeldCandidateHeap<Value> = WeldCandidateHeapNode<Value> | null;

/** One immutable heap pop result. */
export type WeldCandidateHeapPop<Value> = {
  readonly value: Value;
  readonly heap: WeldCandidateHeap<Value>;
};

/** Add one value without changing the existing candidate heap. */
export function pushWeldCandidateHeap<Value>(
  heap: WeldCandidateHeap<Value>,
  value: Value,
  isBefore: (left: Value, right: Value) => boolean,
): WeldCandidateHeap<Value> {
  return mergeHeaps(heap, heapNode(value, null, null), isBefore);
}

/** Remove the first value without changing the existing candidate heap. */
export function popWeldCandidateHeap<Value>(
  heap: WeldCandidateHeap<Value>,
  isBefore: (left: Value, right: Value) => boolean,
): WeldCandidateHeapPop<Value> | null {
  if (heap === null) return null;
  return {
    value: heap.value,
    heap: mergeHeaps(heap.left, heap.right, isBefore),
  };
}

function mergeHeaps<Value>(
  first: WeldCandidateHeap<Value>,
  second: WeldCandidateHeap<Value>,
  isBefore: (left: Value, right: Value) => boolean,
): WeldCandidateHeap<Value> {
  if (first === null) return second;
  if (second === null) return first;
  const root = isBefore(second.value, first.value) ? second : first;
  const remainder = root === first ? second : first;
  const mergedRight = mergeHeaps(root.right, remainder, isBefore);
  return heapNode(root.value, root.left, mergedRight);
}

function heapNode<Value>(
  value: Value,
  first: WeldCandidateHeap<Value>,
  second: WeldCandidateHeap<Value>,
): WeldCandidateHeapNode<Value> {
  const isFirstHigherRank = rankOf(first) >= rankOf(second);
  const left = isFirstHigherRank ? first : second;
  const right = isFirstHigherRank ? second : first;
  return {
    value,
    left,
    right,
    rank: rankOf(right) + 1,
  };
}

function rankOf<Value>(heap: WeldCandidateHeap<Value>): number {
  return heap?.rank ?? 0;
}
