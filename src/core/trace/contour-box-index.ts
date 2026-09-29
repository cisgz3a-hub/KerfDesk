import type { ContourBox } from './contour-bounds';
import { runTraceSteps, type TraceSteps } from './trace-steps';

// The tree's nodes are numbered in the order the build finishes them, so the
// root is the last. Node `k`'s box is `nodeBounds[4k, 4k + 4)`. An inner node
// has `first[k] = left` and `second[k] = right`; a leaf lists
// `order[~first[k], second[k])`, its `first` being negative. Flat arrays keep
// the nodes' bounds out of the heap: the topology repair holds an index for
// every ring it has seen.
type Nodes = {
  readonly bounds: Float64Array;
  readonly first: Int32Array;
  readonly second: Int32Array;
};
// The boxes' bounds and centres, by box, and the box order the build
// partitions. Only `order` moves, by the same swaps an array of entries would
// make, and no leaf's range moves once the leaf is built. Queries test the
// flat bounds, never an item's fields, so items can be made on demand.
type Entries = {
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
    private readonly root: number,
    private readonly nodes: Nodes,
    private readonly item: (index: number) => T,
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
    const bounds = new Float64Array(4 * count);
    for (let i = 0; i < count; i += 1) {
      if (cooperate && i % BUILD_CHECKPOINT_INTERVAL === 0) yield;
      const box = boxes[i] as T;
      bounds[4 * i] = box.minX;
      bounds[4 * i + 1] = box.minY;
      bounds[4 * i + 2] = box.maxX;
      bounds[4 * i + 3] = box.maxY;
    }
    return yield* ContourBoxIndex.overBoundsSteps(bounds, (index) => boxes[index] as T);
  }

  /** An index over the boxes `bounds[4i, 4i + 4)` (minX, minY, maxX, maxY),
   *  whose items are made on demand by `item(i)`, so a caller with many small
   *  items need not keep one object per box. The index keeps `bounds`. */
  static *overBoundsSteps<T extends ContourBox>(
    bounds: Float64Array,
    item: (index: number) => T,
  ): TraceSteps<ContourBoxIndex<T>> {
    const cooperate = yield;
    const count = bounds.length >> 2;
    const entries: Entries = {
      bounds,
      x: new Float64Array(count),
      y: new Float64Array(count),
      order: new Int32Array(count),
    };
    for (let i = 0; i < count; i += 1) {
      if (cooperate && i % BUILD_CHECKPOINT_INTERVAL === 0) yield;
      entries.x[i] = (bounds[4 * i] as number) / 2 + (bounds[4 * i + 2] as number) / 2;
      entries.y[i] = (bounds[4 * i + 1] as number) / 2 + (bounds[4 * i + 3] as number) / 2;
      entries.order[i] = i;
    }
    const size = nodeCount(count, new Map());
    const nodes: Nodes = {
      bounds: new Float64Array(4 * size),
      first: new Int32Array(size),
      second: new Int32Array(size),
    };
    const root = yield* buildTreeSteps(entries, nodes, cooperate);
    return new ContourBoxIndex(root, nodes, item, bounds, entries.order);
  }

  /** Unordered candidates; callers restore their own observable traversal order. */
  query(box: ContourBox): T[] {
    const result: T[] = [];
    if (this.root < 0) return result;
    const { bounds: nodeBounds, first, second } = this.nodes;
    const minX = box.minX,
      minY = box.minY,
      maxX = box.maxX,
      maxY = box.maxY;
    const pending = [this.root];
    while (pending.length > 0) {
      const node = pending.pop() as number;
      const at = 4 * node;
      if (
        !(
          (nodeBounds[at + 2] as number) >= minX &&
          maxX >= (nodeBounds[at] as number) &&
          (nodeBounds[at + 3] as number) >= minY &&
          maxY >= (nodeBounds[at + 1] as number)
        )
      ) {
        continue;
      }
      const left = first[node] as number;
      if (left < 0) this.collectLeaf(~left, second[node] as number, box, result);
      else {
        pending.push(left);
        pending.push(second[node] as number);
      }
    }
    return result;
  }

  private collectLeaf(start: number, end: number, box: ContourBox, result: T[]): void {
    const { item: make, bounds, order } = this;
    const minX = box.minX,
      minY = box.minY,
      maxX = box.maxX,
      maxY = box.maxY;
    for (let i = start; i < end; i += 1) {
      const item = order[i] as number;
      const at = 4 * item;
      if (
        (bounds[at + 2] as number) >= minX &&
        maxX >= (bounds[at] as number) &&
        (bounds[at + 3] as number) >= minY &&
        maxY >= (bounds[at + 1] as number)
      ) {
        result.push(make(item));
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
    const mine = this.item,
      theirs = other.item;
    yield* this.overlapIdsSteps(other, (a, b) => visit(mine(a), theirs(b)), cooperate);
  }

  /** overlapPairsSteps by item number: `visit(i, j, overlapping)` for item
   *  `i` here and item `j` of `other`, without making either item. With a
   *  `margin`, pairs whose boxes come within it of each other are visited
   *  too, and `overlapping` says whether the boxes themselves overlap
   *  (inclusive). A margin of 0 is the plain test: `x + 0` and `x - 0` are
   *  `x` in every comparison, so the same pairs come in the same order. */
  *overlapIdsSteps<U extends ContourBox>(
    other: ContourBoxIndex<U>,
    visit: (item: number, otherItem: number, overlapping: boolean) => void,
    cooperate: boolean,
    margin = 0,
  ): TraceSteps<void> {
    if (this.root < 0 || other.root < 0) return;
    const { bounds: mineBounds, first: mineFirst, second: mineSecond } = this.nodes;
    const { bounds: theirBounds, first: theirFirst, second: theirSecond } = other.nodes;
    const mine: number[] = [this.root];
    const theirs: number[] = [other.root];
    let visited = 0;
    while (mine.length > 0) {
      const a = mine.pop() as number;
      const b = theirs.pop() as number;
      if (!boxesWithin(mineBounds, a, theirBounds, b, margin)) continue;
      if (cooperate && ++visited % PAIR_CHECKPOINT_INTERVAL === 0) yield;
      const aFirst = mineFirst[a] as number;
      const bFirst = theirFirst[b] as number;
      if (aFirst < 0 && bFirst < 0) {
        this.visitLeafPairs(~aFirst, mineSecond[a] as number, other, b, visit, margin);
      } else if (descendsMine(mineBounds, a, aFirst, theirBounds, b, bFirst)) {
        mine.push(aFirst);
        theirs.push(b);
        mine.push(mineSecond[a] as number);
        theirs.push(b);
      } else {
        mine.push(a);
        theirs.push(bFirst);
        mine.push(a);
        theirs.push(theirSecond[b] as number);
      }
    }
  }

  // This index's items are widened by the margin and the other's are not, as
  // boxesWithin widens this index's nodes. Rounding is monotone, so a node
  // pair is never dismissed while two of its items would pass.
  private visitLeafPairs<U extends ContourBox>(
    start: number,
    end: number,
    other: ContourBoxIndex<U>,
    otherLeaf: number,
    visit: (item: number, otherItem: number, overlapping: boolean) => void,
    margin: number,
  ): void {
    const { bounds, order } = this;
    const { bounds: otherBounds, order: otherOrder, nodes } = other;
    const leafAt = 4 * otherLeaf;
    const leafMinX = nodes.bounds[leafAt] as number,
      leafMinY = nodes.bounds[leafAt + 1] as number,
      leafMaxX = nodes.bounds[leafAt + 2] as number,
      leafMaxY = nodes.bounds[leafAt + 3] as number;
    const otherStart = ~(nodes.first[otherLeaf] as number);
    const otherEnd = nodes.second[otherLeaf] as number;
    for (let i = start; i < end; i += 1) {
      const item = order[i] as number;
      const at = 4 * item;
      const lowX = (bounds[at] as number) - margin,
        lowY = (bounds[at + 1] as number) - margin,
        highX = (bounds[at + 2] as number) + margin,
        highY = (bounds[at + 3] as number) + margin;
      if (!(highX >= leafMinX && leafMaxX >= lowX && highY >= leafMinY && leafMaxY >= lowY)) {
        continue;
      }
      for (let j = otherStart; j < otherEnd; j += 1) {
        const otherItem = otherOrder[j] as number;
        const to = 4 * otherItem;
        if (
          highX >= (otherBounds[to] as number) &&
          (otherBounds[to + 2] as number) >= lowX &&
          highY >= (otherBounds[to + 1] as number) &&
          (otherBounds[to + 3] as number) >= lowY
        ) {
          visit(item, otherItem, boxesWithin(bounds, item, otherBounds, otherItem, 0));
        }
      }
    }
  }
}

const PAIR_CHECKPOINT_INTERVAL = 256;

// Descend this tree: its node is the wider, or the other's is a leaf.
function descendsMine(
  mineBounds: Float64Array,
  a: number,
  aFirst: number,
  theirBounds: Float64Array,
  b: number,
  bFirst: number,
): boolean {
  return bFirst < 0 || (aFirst >= 0 && wider(mineBounds, a, theirBounds, b));
}

// Whether box `a` of `aBounds` (4 per box), widened by `margin`, overlaps box
// `b` of `bBounds` (inclusive). Nodes and items are laid out alike.
function boxesWithin(
  aBounds: Float64Array,
  a: number,
  bBounds: Float64Array,
  b: number,
  margin: number,
): boolean {
  const at = 4 * a,
    bt = 4 * b;
  return (
    (aBounds[at + 2] as number) + margin >= (bBounds[bt] as number) &&
    (bBounds[bt + 2] as number) >= (aBounds[at] as number) - margin &&
    (aBounds[at + 3] as number) + margin >= (bBounds[bt + 1] as number) &&
    (bBounds[bt + 3] as number) >= (aBounds[at + 1] as number) - margin
  );
}

function wider(aBounds: Float64Array, a: number, bBounds: Float64Array, b: number): boolean {
  const at = 4 * a,
    bt = 4 * b;
  const aSpan =
    (aBounds[at + 2] as number) -
    (aBounds[at] as number) +
    ((aBounds[at + 3] as number) - (aBounds[at + 1] as number));
  const bSpan =
    (bBounds[bt + 2] as number) -
    (bBounds[bt] as number) +
    ((bBounds[bt + 3] as number) - (bBounds[bt + 1] as number));
  return aSpan >= bSpan;
}

// Nodes in a tree over `count` boxes: the build halves every range longer
// than LEAF_SIZE. The ranges at one depth differ by at most one in length, so
// few lengths recur and the memo keeps this logarithmic.
function nodeCount(count: number, memo: Map<number, number>): number {
  if (count === 0) return 0;
  if (count <= LEAF_SIZE) return 1;
  const known = memo.get(count);
  if (known !== undefined) return known;
  const half = Math.floor(count / 2);
  const total = 1 + nodeCount(half, memo) + nodeCount(count - half, memo);
  memo.set(count, total);
  return total;
}

type BuildFrame = {
  readonly start: number;
  readonly end: number;
  middle: number;
  left: number;
  stage: 0 | 1 | 2;
};

// The tree is built depth first, left before right, as a recursion would,
// but on an explicit stack inside one generator: a recursive generator pays
// one resumption per level for every checkpoint, which dominated the build.
// Each node still partitions only its own range, so the tree is the same.
// Returns the root's number, or -1 for no boxes.
function* buildTreeSteps(entries: Entries, nodes: Nodes, cooperate: boolean): TraceSteps<number> {
  if (entries.order.length === 0) return -1;
  const stack: BuildFrame[] = [frame(0, entries.order.length)];
  let built = -1;
  let next = 0;
  let visited = 0;
  while (stack.length > 0) {
    const top = stack[stack.length - 1] as BuildFrame;
    if (top.stage === 0) {
      if (cooperate && visited++ % NODE_CHECKPOINT_INTERVAL === 0) yield;
      if (top.end - top.start <= LEAF_SIZE) {
        built = leaf(entries, nodes, next, top.start, top.end);
        next += 1;
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
      built = join(nodes, next, top.left, built);
      next += 1;
      stack.pop();
    }
  }
  return built;
}

function frame(start: number, end: number): BuildFrame {
  return { start, end, middle: start, left: -1, stage: 0 };
}

// A node's bounds are its children's, joined: min and max are exact and
// order-free, so this is the box of all its items without revisiting them.
function join(nodes: Nodes, node: number, left: number, right: number): number {
  const { bounds } = nodes;
  const at = 4 * node,
    l = 4 * left,
    r = 4 * right;
  bounds[at] = Math.min(bounds[l] as number, bounds[r] as number);
  bounds[at + 1] = Math.min(bounds[l + 1] as number, bounds[r + 1] as number);
  bounds[at + 2] = Math.max(bounds[l + 2] as number, bounds[r + 2] as number);
  bounds[at + 3] = Math.max(bounds[l + 3] as number, bounds[r + 3] as number);
  nodes.first[node] = left;
  nodes.second[node] = right;
  return node;
}

function leaf(entries: Entries, nodes: Nodes, node: number, start: number, end: number): number {
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
  const at = 4 * node;
  nodes.bounds[at] = minX;
  nodes.bounds[at + 1] = minY;
  nodes.bounds[at + 2] = maxX;
  nodes.bounds[at + 3] = maxY;
  nodes.first[node] = ~start;
  nodes.second[node] = end;
  return node;
}

function splitsHorizontally(entries: Entries, start: number, end: number): boolean {
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
