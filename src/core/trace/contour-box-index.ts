import { boxesOverlap, type ContourBox } from './contour-bounds';
import { runTraceSteps, type TraceSteps } from './trace-steps';

type BoxNode<T> = ContourBox & {
  readonly left?: BoxNode<T> | undefined;
  readonly right?: BoxNode<T> | undefined;
  readonly items?: ReadonlyArray<T>;
};
// The boxes' centres, by box, and the box order the build partitions. Only
// `order` moves, by the same swaps an array of entries would make.
type Entries<T> = {
  readonly boxes: ReadonlyArray<T>;
  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly order: Int32Array;
};
const LEAF_SIZE = 8;
const BUILD_CHECKPOINT_INTERVAL = 256;
// Nodes built between checkpoints; a leaf holds up to LEAF_SIZE items.
const NODE_CHECKPOINT_INTERVAL = 32;

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
    const count = boxes.length;
    const entries: Entries<T> = {
      boxes,
      x: new Float64Array(count),
      y: new Float64Array(count),
      order: new Int32Array(count),
    };
    for (let i = 0; i < count; i += 1) {
      if (cooperate && i % BUILD_CHECKPOINT_INTERVAL === 0) yield;
      const box = boxes[i] as T;
      entries.x[i] = box.minX / 2 + box.maxX / 2;
      entries.y[i] = box.minY / 2 + box.maxY / 2;
      entries.order[i] = i;
    }
    return new ContourBoxIndex(yield* buildTreeSteps(entries, cooperate));
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

type BuildFrame<T> = {
  readonly start: number;
  readonly end: number;
  middle: number;
  left: BoxNode<T> | undefined;
  stage: 0 | 1 | 2;
};

// The tree is built depth first, left before right, as a recursion would,
// but on an explicit stack inside one generator: a recursive generator pays
// one resumption per level for every checkpoint, which dominated the build.
// Each node still partitions only its own range, so the tree is the same.
function* buildTreeSteps<T extends ContourBox>(
  entries: Entries<T>,
  cooperate: boolean,
): TraceSteps<BoxNode<T> | undefined> {
  if (entries.order.length === 0) return undefined;
  const stack: BuildFrame<T>[] = [frame(0, entries.order.length)];
  let built: BoxNode<T> | undefined;
  let visited = 0;
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as BuildFrame<T>;
    if (top.stage === 0) {
      if (cooperate && visited++ % NODE_CHECKPOINT_INTERVAL === 0) yield;
      if (top.end - top.start <= LEAF_SIZE) {
        built = leaf(entries, top.start, top.end);
        stack.pop();
        continue;
      }
      top.middle = Math.floor((top.start + top.end) / 2);
      const keys = splitsHorizontally(entries, top.start, top.end) ? entries.x : entries.y;
      selectMiddle(entries.order, keys, top.start, top.end, top.middle);
      top.stage = 1;
      stack.push(frame(top.start, top.middle));
    } else if (top.stage === 1) {
      top.left = built;
      top.stage = 2;
      stack.push(frame(top.middle, top.end));
    } else {
      built = join(top.left as BoxNode<T>, built as BoxNode<T>);
      stack.pop();
    }
  }
  return built;
}

function frame<T>(start: number, end: number): BuildFrame<T> {
  return { start, end, middle: start, left: undefined, stage: 0 };
}

// A node's bounds are its children's, joined: min and max are exact and
// order-free, so this is the box of all its items without revisiting them.
function join<T>(left: BoxNode<T>, right: BoxNode<T>): BoxNode<T> {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    left,
    right,
  };
}

function leaf<T extends ContourBox>(entries: Entries<T>, start: number, end: number) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const items: T[] = [];
  for (let i = start; i < end; i += 1) {
    const box = entries.boxes[entries.order[i] as number] as T;
    minX = Math.min(minX, box.minX);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
    maxY = Math.max(maxY, box.maxY);
    items.push(box);
  }
  return { minX, minY, maxX, maxY, items };
}

function splitsHorizontally<T>(entries: Entries<T>, start: number, end: number): boolean {
  const { x: xs, y: ys, order } = entries;
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity;
  for (let i = start; i < end; i += 1) {
    const item = order[i] as number;
    const x = xs[item] as number,
      y = ys[item] as number;
    lowX = Math.min(lowX, x);
    lowY = Math.min(lowY, y);
    highX = Math.max(highX, x);
    highY = Math.max(highY, y);
  }
  // Parallel strips can overlap along their longest axis. Split on the
  // centroid spread instead, so separation on the other axis is retained.
  return highX - lowX >= highY - lowY;
}

// Quickselect `middle` into place on `keys`, the chosen axis's centres.
function selectMiddle(
  order: Int32Array,
  keys: Float64Array,
  start: number,
  end: number,
  middle: number,
): void {
  let budget = 2 * Math.ceil(Math.log2(end - start));
  while (end - start > 1) {
    // Bound pathological pivot sequences without sorting each ordinary node.
    if (budget-- === 0) {
      // A stable sort, as Array.prototype.sort is, of the same sequence.
      const sorted = Array.from(order.subarray(start, end)).sort(
        (a, b) => (keys[a] as number) - (keys[b] as number),
      );
      order.set(sorted, start);
      return;
    }
    const pivot = keys[order[Math.floor((start + end) / 2)] as number] as number;
    const [low, high] = partition(order, keys, start, end, pivot);
    if (middle < low) end = low;
    else if (middle >= high) start = high;
    else return;
  }
}

// Order [start, end) as below, equal to, then above `pivot`; returns the
// equal run's bounds.
function partition(
  order: Int32Array,
  keys: Float64Array,
  start: number,
  end: number,
  pivot: number,
): [number, number] {
  let low = start,
    cursor = start,
    high = end;
  while (cursor < high) {
    const item = order[cursor] as number;
    const key = keys[item] as number;
    if (key < pivot) {
      order[cursor] = order[low] as number;
      order[low] = item;
      low += 1;
      cursor += 1;
    } else if (key > pivot) {
      high -= 1;
      order[cursor] = order[high] as number;
      order[high] = item;
    } else cursor += 1;
  }
  return [low, high];
}
