import { boxesOverlap, type ContourBox } from './contour-bounds';
import { runTraceSteps, type TraceSteps } from './trace-steps';

type BoxNode<T> = ContourBox & {
  readonly left?: BoxNode<T> | undefined;
  readonly right?: BoxNode<T> | undefined;
  readonly items?: ReadonlyArray<T>;
};
type Entry<T> = { readonly box: T; readonly x: number; readonly y: number };
const LEAF_SIZE = 8;
const BUILD_CHECKPOINT_INTERVAL = 256;

/** Immutable finite boxes. Queries retain inclusive boundary contacts. */
export class ContourBoxIndex<T extends ContourBox> {
  private constructor(private readonly root: BoxNode<T> | undefined) {}

  static create<T extends ContourBox>(boxes: ReadonlyArray<T>): ContourBoxIndex<T> {
    return runTraceSteps(ContourBoxIndex.createSteps(boxes));
  }

  static *createSteps<T extends ContourBox>(
    boxes: ReadonlyArray<T>,
  ): TraceSteps<ContourBoxIndex<T>> {
    const cooperate = yield;
    const entries: Entry<T>[] = [];
    for (const box of boxes) {
      if (cooperate && entries.length % BUILD_CHECKPOINT_INTERVAL === 0) yield;
      entries.push({ box, x: box.minX / 2 + box.maxX / 2, y: box.minY / 2 + box.maxY / 2 });
    }
    return new ContourBoxIndex(yield* buildNodeSteps(entries, 0, entries.length, cooperate));
  }

  /** Unordered candidates; callers restore their own observable traversal order. */
  query(box: ContourBox): T[] {
    const result: T[] = [];
    const pending = this.root === undefined ? [] : [this.root];
    while (pending.length > 0) {
      const node = pending.pop();
      if (node === undefined || !boxesOverlap(node, box)) continue;
      if (node.items !== undefined) {
        for (const item of node.items) if (boxesOverlap(item, box)) result.push(item);
      } else {
        if (node.left !== undefined) pending.push(node.left);
        if (node.right !== undefined) pending.push(node.right);
      }
    }
    return result;
  }
}

function* buildNodeSteps<T extends ContourBox>(
  entries: Entry<T>[],
  start: number,
  end: number,
  cooperate: boolean,
): TraceSteps<BoxNode<T> | undefined> {
  if (start === end) return undefined;
  if (cooperate) yield;
  const { bounds, horizontal } = measure(entries, start, end);
  if (end - start <= LEAF_SIZE)
    return { ...bounds, items: entries.slice(start, end).map((e) => e.box) };
  const middle = Math.floor((start + end) / 2);
  selectMiddle(entries, start, end, middle, horizontal ? 'x' : 'y');
  return {
    ...bounds,
    left: yield* buildNodeSteps(entries, start, middle, cooperate),
    right: yield* buildNodeSteps(entries, middle, end, cooperate),
  };
}

function measure<T extends ContourBox>(
  entries: ReadonlyArray<Entry<T>>,
  start: number,
  end: number,
) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity;
  for (let i = start; i < end; i += 1) {
    const entry = entries[i];
    if (entry === undefined) continue;
    const { box, x, y } = entry;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
    lowX = Math.min(lowX, x);
    lowY = Math.min(lowY, y);
    highX = Math.max(highX, x);
    highY = Math.max(highY, y);
  }
  // Parallel strips can overlap along their longest axis. Split on the
  // centroid spread instead, so separation on the other axis is retained.
  return { bounds: { minX, minY, maxX, maxY }, horizontal: highX - lowX >= highY - lowY };
}

function selectMiddle<T>(
  entries: Entry<T>[],
  start: number,
  end: number,
  middle: number,
  axis: 'x' | 'y',
): void {
  let budget = 2 * Math.ceil(Math.log2(end - start));
  while (end - start > 1) {
    // Bound pathological pivot sequences without sorting each ordinary node.
    if (budget-- === 0) {
      const sorted = entries.slice(start, end).sort((a, b) => a[axis] - b[axis]);
      for (const [i, item] of sorted.entries()) entries[start + i] = item;
      return;
    }
    const pivot = entries[Math.floor((start + end) / 2)]?.[axis];
    if (pivot === undefined) return;
    const [low, high] = partition(entries, start, end, axis, pivot);
    if (middle < low) end = low;
    else if (middle >= high) start = high;
    else return;
  }
}

function partition<T>(
  entries: Entry<T>[],
  start: number,
  end: number,
  axis: 'x' | 'y',
  pivot: number,
): [number, number] {
  let low = start,
    cursor = start,
    high = end;
  while (cursor < high) {
    const entry = entries[cursor];
    if (entry === undefined) {
      cursor += 1;
      continue;
    }
    if (entry[axis] < pivot) {
      swap(entries, low++, cursor++);
    } else if (entry[axis] > pivot) {
      swap(entries, --high, cursor);
    } else cursor += 1;
  }
  return [low, high];
}

function swap<T>(entries: T[], a: number, b: number): void {
  const first = entries[a],
    second = entries[b];
  if (first !== undefined && second !== undefined) {
    entries[a] = second;
    entries[b] = first;
  }
}
