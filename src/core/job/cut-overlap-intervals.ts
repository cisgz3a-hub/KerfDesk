/** Assign each covered interval to the earliest contour. A sweep with a lazy
 * minimum heap avoids comparing every pair of collinear edges. */
export type OwnedInterval = { readonly low: number; readonly high: number; readonly owner: number };

export function firstContourIntervals(edges: ReadonlyArray<OwnedInterval>): OwnedInterval[] {
  const events = edges.flatMap(({ low, high, owner }) => [
    { at: low, owner, delta: 1 },
    { at: high, owner, delta: -1 },
  ]);
  events.sort((a, b) => a.at - b.at);
  const counts = new Map<number, number>();
  const heap: number[] = [];
  const result: OwnedInterval[] = [];
  let previous = events[0]?.at ?? 0;
  for (const event of events) {
    appendInterval(result, previous, event.at, firstActiveOwner(heap, counts));
    const oldCount = counts.get(event.owner) ?? 0;
    const count = oldCount + event.delta;
    counts.set(event.owner, count);
    if (oldCount === 0 && count > 0) pushMinimum(heap, event.owner);
    previous = event.at;
  }
  return result;
}

function firstActiveOwner(heap: number[], counts: ReadonlyMap<number, number>): number | undefined {
  while (heap.length > 0 && (counts.get(heap[0] as number) ?? 0) === 0) popMinimum(heap);
  return heap[0];
}

function appendInterval(
  result: OwnedInterval[],
  low: number,
  high: number,
  owner: number | undefined,
): void {
  if (owner === undefined || high <= low) return;
  const last = result[result.length - 1];
  if (last?.owner === owner && last.high === low) result[result.length - 1] = { ...last, high };
  else result.push({ low, high, owner });
}

function pushMinimum(heap: number[], value: number): void {
  let index = heap.length;
  heap.push(value);
  while (index > 0) {
    const parent = Math.floor((index - 1) / 2);
    if ((heap[parent] as number) <= value) break;
    heap[index] = heap[parent] as number;
    index = parent;
  }
  heap[index] = value;
}

function popMinimum(heap: number[]): void {
  const value = heap.pop();
  if (value === undefined || heap.length === 0) return;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    const left = index * 2 + 1;
    const right = left + 1;
    const child =
      right < heap.length && (heap[right] as number) < (heap[left] as number) ? right : left;
    if ((heap[child] as number) >= value) break;
    heap[index] = heap[child] as number;
    index = child;
  }
  heap[index] = value;
}
