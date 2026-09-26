import { boxesOverlap, type ContourBox } from './contour-bounds';
import { runTraceSteps, type TraceSteps } from './trace-steps';

// Every node has one shape. A leaf lists `order[start, end)`; an inner node
// has children and start = end = -1.
type BoxNode = ContourBox & {
  readonly left: BoxNode | undefined;
  readonly right: BoxNode | undefined;
  readonly start: number;
  readonly end: number;
};
// The boxes' bounds and centres, by box, and the box order the build
// partitions. Only `order` moves, by the same swaps an array of entries would
// make, and no leaf's range moves once the leaf is built. The bounds are read
// once, here: queries test these flat copies instead of each item's fields.
type Entries<T> = {
  readonly boxes: ReadonlyArray<T>;
  readonly bounds: Float64Array;
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
  private constructor(
    private readonly root: BoxNode | undefined,
    private readonly boxes: ReadonlyArray<T>,
    private readonly bounds: Float64Array,
    private readonly order: Int32Array,
  ) {}

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
      bounds: new Float64Array(4 * count),
      x: new Float64Array(count),
      y: new Float64Array(count),
      order: new Int32Array(count),
    };
    const { bounds } = entries;
    for (let i = 0; i < count; i += 1) {
      if (cooperate && i % BUILD_CHECKPOINT_INTERVAL === 0) yield;
      const box = boxes[i] as T;
      const minX = box.minX,
        minY = box.minY,
        maxX = box.maxX,
        maxY = box.maxY;
      bounds[4 * i] = minX;
      bounds[4 * i + 1] = minY;
      bounds[4 * i + 2] = maxX;
      bounds[4 * i + 3] = maxY;
      entries.x[i] = minX / 2 + maxX / 2;
      entries.y[i] = minY / 2 + maxY / 2;
      entries.order[i] = i;
    }
    const root = yield* buildTreeSteps(entries, cooperate);
    return new ContourBoxIndex(root, boxes, bounds, entries.order);
  }

  /** Unordered candidates; callers restore their own observable traversal order. */
  query(box: ContourBox): T[] {
    const result: T[] = [];
    const pending = this.root === undefined ? [] : [this.root];
    while (pending.length > 0) {
      const node = pending.pop() as BoxNode;
      if (!boxesOverlap(node, box)) continue;
      if (node.start >= 0) this.collectLeaf(node, box, result);
      else {
        if (node.left !== undefined) pending.push(node.left);
        if (node.right !== undefined) pending.push(node.right);
      }
    }
    return result;
  }

  private collectLeaf(leaf: BoxNode, box: ContourBox, result: T[]): void {
    const { boxes, bounds, order } = this;
    const minX = box.minX,
      minY = box.minY,
      maxX = box.maxX,
      maxY = box.maxY;
    for (let i = leaf.start; i < leaf.end; i += 1) {
      const item = order[i] as number;
      const at = 4 * item;
      if (
        (bounds[at + 2] as number) >= minX &&
        maxX >= (bounds[at] as number) &&
        (bounds[at + 3] as number) >= minY &&
        maxY >= (bounds[at + 1] as number)
      ) {
        result.push(boxes[item] as T);
      }
    }
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
    const mine: BoxNode[] = [this.root];
    const theirs: BoxNode[] = [other.root];
    let visited = 0;
    while (mine.length > 0) {
      const a = mine.pop() as BoxNode;
      const b = theirs.pop() as BoxNode;
      if (!boxesOverlap(a, b)) continue;
      if (cooperate && ++visited % PAIR_CHECKPOINT_INTERVAL === 0) yield;
      if (a.start >= 0 && b.start >= 0) {
        this.visitLeafPairs(a, other, b, visit);
      } else if (b.start >= 0 || (a.start < 0 && wider(a, b))) {
        pushChildren(a, b, mine, theirs);
      } else {
        pushOtherChildren(a, b, mine, theirs);
      }
    }
  }

  private visitLeafPairs<U extends ContourBox>(
    leaf: BoxNode,
    other: ContourBoxIndex<U>,
    otherLeaf: BoxNode,
    visit: (item: T, otherItem: U) => void,
  ): void {
    const { boxes, bounds, order } = this;
    const { boxes: otherBoxes, bounds: otherBounds, order: otherOrder } = other;
    for (let i = leaf.start; i < leaf.end; i += 1) {
      const item = order[i] as number;
      const at = 4 * item;
      const minX = bounds[at] as number,
        minY = bounds[at + 1] as number,
        maxX = bounds[at + 2] as number,
        maxY = bounds[at + 3] as number;
      if (
        !(
          maxX >= otherLeaf.minX &&
          otherLeaf.maxX >= minX &&
          maxY >= otherLeaf.minY &&
          otherLeaf.maxY >= minY
        )
      ) {
        continue;
      }
      for (let j = otherLeaf.start; j < otherLeaf.end; j += 1) {
        const otherItem = otherOrder[j] as number;
        const to = 4 * otherItem;
        if (
          maxX >= (otherBounds[to] as number) &&
          (otherBounds[to + 2] as number) >= minX &&
          maxY >= (otherBounds[to + 1] as number) &&
          (otherBounds[to + 3] as number) >= minY
        ) {
          visit(boxes[item] as T, otherBoxes[otherItem] as U);
        }
      }
    }
  }
}

const PAIR_CHECKPOINT_INTERVAL = 256;

function wider(a: ContourBox, b: ContourBox): boolean {
  return a.maxX - a.minX + (a.maxY - a.minY) >= b.maxX - b.minX + (b.maxY - b.minY);
}

function pushChildren(a: BoxNode, b: BoxNode, mine: BoxNode[], theirs: BoxNode[]): void {
  for (const child of [a.left, a.right]) {
    if (child === undefined) continue;
    mine.push(child);
    theirs.push(b);
  }
}

function pushOtherChildren(a: BoxNode, b: BoxNode, mine: BoxNode[], theirs: BoxNode[]): void {
  for (const child of [b.left, b.right]) {
    if (child === undefined) continue;
    mine.push(a);
    theirs.push(child);
  }
}

type BuildFrame = {
  readonly start: number;
  readonly end: number;
  middle: number;
  left: BoxNode | undefined;
  stage: 0 | 1 | 2;
};

// The tree is built depth first, left before right, as a recursion would,
// but on an explicit stack inside one generator: a recursive generator pays
// one resumption per level for every checkpoint, which dominated the build.
// Each node still partitions only its own range, so the tree is the same.
function* buildTreeSteps<T extends ContourBox>(
  entries: Entries<T>,
  cooperate: boolean,
): TraceSteps<BoxNode | undefined> {
  if (entries.order.length === 0) return undefined;
  const stack: BuildFrame[] = [frame(0, entries.order.length)];
  let built: BoxNode | undefined;
  let visited = 0;
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as BuildFrame;
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
      built = join(top.left as BoxNode, built as BoxNode);
      stack.pop();
    }
  }
  return built;
}

function frame(start: number, end: number): BuildFrame {
  return { start, end, middle: start, left: undefined, stage: 0 };
}

// A node's bounds are its children's, joined: min and max are exact and
// order-free, so this is the box of all its items without revisiting them.
function join(left: BoxNode, right: BoxNode): BoxNode {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
    left,
    right,
    start: -1,
    end: -1,
  };
}

function leaf<T>(entries: Entries<T>, start: number, end: number): BoxNode {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  const { bounds, order } = entries;
  for (let i = start; i < end; i += 1) {
    const at = 4 * (order[i] as number);
    minX = Math.min(minX, bounds[at] as number);
    minY = Math.min(minY, bounds[at + 1] as number);
    maxX = Math.max(maxX, bounds[at + 2] as number);
    maxY = Math.max(maxY, bounds[at + 3] as number);
  }
  return { minX, minY, maxX, maxY, left: undefined, right: undefined, start, end };
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
