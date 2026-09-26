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

  /** Every pair of an item here and an item of `other` whose boxes overlap
   *  (inclusive), in no particular order. The same pairs as querying `other`
   *  with each item here, found by descending both trees together, so node
   *  pairs that are apart are dismissed once instead of once per item. */
  *overlapPairsSteps<U extends ContourBox>(
    other: ContourBoxIndex<U>,
    visit: (item: T, otherItem: U) => void,
    cooperate: boolean,
  ): TraceSteps<void> {
    if (this.root === undefined || other.root === undefined) return;
    const mine: BoxNode<T>[] = [this.root];
    const theirs: BoxNode<U>[] = [other.root];
    let visited = 0;
    while (mine.length > 0) {
      const a = mine.pop() as BoxNode<T>;
      const b = theirs.pop() as BoxNode<U>;
      if (!boxesOverlap(a, b)) continue;
      if (cooperate && ++visited % PAIR_CHECKPOINT_INTERVAL === 0) yield;
      if (a.items !== undefined && b.items !== undefined) {
        visitLeafPairs(a.items, b, b.items, visit);
      } else if (b.items !== undefined || (a.items === undefined && wider(a, b))) {
        pushChildren(a, b, mine, theirs);
      } else {
        pushOtherChildren(a, b, mine, theirs);
      }
    }
  }
}

const PAIR_CHECKPOINT_INTERVAL = 256;

function visitLeafPairs<T extends ContourBox, U extends ContourBox>(
  items: ReadonlyArray<T>,
  leaf: ContourBox,
  others: ReadonlyArray<U>,
  visit: (item: T, otherItem: U) => void,
): void {
  for (const item of items) {
    if (!boxesOverlap(item, leaf)) continue;
    for (const otherItem of others) if (boxesOverlap(item, otherItem)) visit(item, otherItem);
  }
}

function wider(a: ContourBox, b: ContourBox): boolean {
  return a.maxX - a.minX + (a.maxY - a.minY) >= b.maxX - b.minX + (b.maxY - b.minY);
}

function pushChildren<T, U>(
  a: BoxNode<T>,
  b: BoxNode<U>,
  mine: BoxNode<T>[],
  theirs: BoxNode<U>[],
): void {
  for (const child of [a.left, a.right]) {
    if (child === undefined) continue;
    mine.push(child);
    theirs.push(b);
  }
}

function pushOtherChildren<T, U>(
  a: BoxNode<T>,
  b: BoxNode<U>,
  mine: BoxNode<T>[],
  theirs: BoxNode<U>[],
): void {
  for (const child of [b.left, b.right]) {
    if (child === undefined) continue;
    mine.push(a);
    theirs.push(child);
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
  if (end - start <= LEAF_SIZE) return leaf(entries, start, end);
  const middle = Math.floor((start + end) / 2);
  selectMiddle(entries, start, end, middle, splitsHorizontally(entries, start, end) ? 'x' : 'y');
  const left = (yield* buildNodeSteps(entries, start, middle, cooperate)) as BoxNode<T>;
  const right = (yield* buildNodeSteps(entries, middle, end, cooperate)) as BoxNode<T>;
  // A node's bounds are its children's, joined: min and max are exact and
  // order-free, so this is the box of all its items without revisiting them.
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    left,
    right,
  };
}

function leaf<T extends ContourBox>(entries: ReadonlyArray<Entry<T>>, start: number, end: number) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const items: T[] = [];
  for (let i = start; i < end; i += 1) {
    const { box } = entries[i] as Entry<T>;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
    items.push(box);
  }
  return { minX, minY, maxX, maxY, items };
}

function splitsHorizontally<T>(
  entries: ReadonlyArray<Entry<T>>,
  start: number,
  end: number,
): boolean {
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity;
  for (let i = start; i < end; i += 1) {
    const { x, y } = entries[i] as Entry<T>;
    lowX = Math.min(lowX, x);
    lowY = Math.min(lowY, y);
    highX = Math.max(highX, x);
    highY = Math.max(highY, y);
  }
  // Parallel strips can overlap along their longest axis. Split on the
  // centroid spread instead, so separation on the other axis is retained.
  return highX - lowX >= highY - lowY;
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
