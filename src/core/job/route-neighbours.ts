// Neighbour lists for route refinement (ADR-669): for each item, the items
// whose ends lie nearest its own. A k-d tree over every item end, split at the
// median of the wider axis, so dense clusters cost no more than spread-out
// sheets (a uniform grid put a whole cluster in one cell).
//
// Deterministic: the tree splits by (coordinate, end index), the search visits
// it in a fixed order, and results rank by (squared distance, item). A subtree
// that cannot hold a strictly nearer end is skipped, so among ends tied at the
// last neighbour's distance the ones met first stay: still a function of the
// input alone, and a pile of coincident ends costs one leaf, not a full scan.
// Only exact arithmetic is used.

import type { Vec2 } from '../scene';
import type { RouteItem } from './route-refine';

const NEIGHBOURS = 16;
const LEAF_SIZE = 8;

/** The NEIGHBOURS items nearest each item (its nearest end to their nearest end), and nearest the start. */
export function neighbourLists(
  items: ReadonlyArray<RouteItem>,
  start: Vec2,
): { readonly items: Int32Array[]; readonly start: Int32Array } {
  const tree = new EndTree(items);
  return {
    items: items.map((item, index) => tree.nearest([item.entry, item.exit], index)),
    start: tree.nearest([start], -1),
  };
}

type Node =
  | { readonly leaf: true; readonly from: number; readonly to: number }
  | {
      readonly leaf: false;
      readonly axis: 0 | 1;
      readonly split: number;
      readonly low: Node;
      readonly high: Node;
    };

class EndTree {
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private readonly owners: Int32Array;
  private readonly order: Int32Array;
  private readonly root: Node;

  constructor(items: ReadonlyArray<RouteItem>) {
    const count = items.length * 2;
    this.xs = new Float64Array(count);
    this.ys = new Float64Array(count);
    this.owners = new Int32Array(count);
    items.forEach((item, index) => {
      this.xs[2 * index] = item.entry.x;
      this.ys[2 * index] = item.entry.y;
      this.xs[2 * index + 1] = item.exit.x;
      this.ys[2 * index + 1] = item.exit.y;
      this.owners[2 * index] = index;
      this.owners[2 * index + 1] = index;
    });
    this.order = Int32Array.from({ length: count }, (_, at) => at);
    this.root = this.build(0, count);
  }

  private build(from: number, to: number): Node {
    if (to - from <= LEAF_SIZE) return { leaf: true, from, to };
    const axis = this.widerAxis(from, to);
    const keys = axis === 0 ? this.xs : this.ys;
    const slice = Array.from(this.order.subarray(from, to)).sort(
      (a, b) => (keys[a] as number) - (keys[b] as number) || a - b,
    );
    this.order.set(slice, from);
    const middle = from + ((to - from) >> 1);
    return {
      leaf: false,
      axis,
      split: keys[this.order[middle] as number] as number,
      low: this.build(from, middle),
      high: this.build(middle, to),
    };
  }

  private widerAxis(from: number, to: number): 0 | 1 {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let at = from; at < to; at += 1) {
      const end = this.order[at] as number;
      minX = Math.min(minX, this.xs[end] as number);
      maxX = Math.max(maxX, this.xs[end] as number);
      minY = Math.min(minY, this.ys[end] as number);
      maxY = Math.max(maxY, this.ys[end] as number);
    }
    return maxX - minX >= maxY - minY ? 0 : 1;
  }

  /** Up to NEIGHBOURS items other than `self`, nearest any of `from`, sorted by (distance, item). */
  nearest(from: ReadonlyArray<Vec2>, self: number): Int32Array {
    const best = new Ranked(self);
    for (const point of from) this.search(this.root, point, best);
    return best.items();
  }

  private search(node: Node, point: Vec2, best: Ranked): void {
    if (node.leaf) {
      for (let at = node.from; at < node.to; at += 1) {
        const end = this.order[at] as number;
        const dx = (this.xs[end] as number) - point.x;
        const dy = (this.ys[end] as number) - point.y;
        best.offer(this.owners[end] as number, dx * dx + dy * dy);
      }
      return;
    }
    const offset = (node.axis === 0 ? point.x : point.y) - node.split;
    const [near, far] = offset < 0 ? [node.low, node.high] : [node.high, node.low];
    this.search(near, point, best);
    // Every end on the far side is at least |offset| away.
    if (offset * offset < best.bound()) this.search(far, point, best);
  }
}

// The NEIGHBOURS nearest distinct items seen so far, by (squared distance, item).
class Ranked {
  private readonly owners: number[] = [];
  private readonly distances: number[] = [];

  constructor(private readonly self: number) {}

  offer(owner: number, d: number): void {
    if (owner === this.self) return;
    const known = this.owners.indexOf(owner);
    if (known >= 0) {
      if ((this.distances[known] as number) <= d) return;
      this.owners.splice(known, 1);
      this.distances.splice(known, 1);
    } else if (this.owners.length >= NEIGHBOURS && !this.before(owner, d, NEIGHBOURS - 1)) return;
    let at = this.owners.length;
    while (at > 0 && this.before(owner, d, at - 1)) at -= 1;
    this.owners.splice(at, 0, owner);
    this.distances.splice(at, 0, d);
    if (this.owners.length > NEIGHBOURS) {
      this.owners.pop();
      this.distances.pop();
    }
  }

  // Whether (d, owner) ranks ahead of the entry at `index`.
  private before(owner: number, d: number, index: number): boolean {
    const other = this.distances[index] as number;
    return d < other || (d === other && owner < (this.owners[index] as number));
  }

  bound(): number {
    return this.owners.length < NEIGHBOURS ? Infinity : (this.distances[NEIGHBOURS - 1] as number);
  }

  items(): Int32Array {
    return Int32Array.from(this.owners);
  }
}
