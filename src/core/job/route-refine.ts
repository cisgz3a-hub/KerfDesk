// Route refinement after nearest-neighbour (ADR-669): 2-opt and Or-opt moves
// over a route of items, each entered at one point and left at another.
//
// WHY: nearest-neighbour is greedy from a fixed start. On real sheets it ends
// far from the park the program returns to and leaves long hops it never
// revisits; tour studies put it about 25 percent above optimal, and 2-opt with
// Or-opt within a few percent. The emitted program parks after the last cut, so
// the route is scored as a closed tour back to `returnTo` when one is given.
//
// WHAT A MOVE MAY CHANGE: visit order, and the direction of an item only when
// it is `flippable` (an open path under Allow reverse). An item that starts
// where it ends (a closed contour) is never flipped: reversing its place in a
// sub-route costs nothing and keeps its cut direction. A move is rejected when
// it would cut an item before one it holds back (inside-first-holds.ts), when
// it needs to flip an item that may not be flipped, or when it would displace a
// pinned first item.
//
// DETERMINISM (PROJECT.md non-negotiable #5): candidates are visited in a fixed
// order, neighbour lists are sorted by (distance, item), distances use only
// IEEE-exact operations (Math.sqrt, never Math.hypot), and the work is bounded
// by a count of steps, never by time. Pure: no clock, no random, no I/O.

import type { Vec2 } from '../scene';
import type { InsideFirstHolds } from './inside-first-holds';
import { neighbourLists } from './route-neighbours';

export type RouteItem = {
  readonly entry: Vec2;
  readonly exit: Vec2;
  /** The item may be run backwards, swapping its entry and exit. */
  readonly flippable: boolean;
};

export type RouteRefinement = {
  readonly start: Vec2;
  /** Where the head goes after the last item; null scores an open route. */
  readonly returnTo: Vec2 | null;
  /** Keep the first item first (a Line burn start region chose it). */
  readonly pinFirst: boolean;
  readonly holds?: InsideFirstHolds;
};

export type RefinedRoute = {
  /** Item indices in their new visiting order. */
  readonly order: ReadonlyArray<number>;
  /** Per item: run it backwards. Only ever true for a flippable item. */
  readonly flipped: ReadonlyArray<boolean>;
};

type Chunk = {
  readonly i: number;
  readonly end: number;
  /** Route length saved by taking the chunk out. */
  readonly removed: number;
  readonly reversed: boolean;
  readonly head: number;
  readonly tail: number;
  readonly entry: Vec2;
  readonly exit: Vec2;
};

const MAX_CHUNK = 3;
// An improvement must beat float noise in summed distances to count.
const IMPROVEMENT_MM = 1e-7;
const WORK_PER_ITEM = 256;
const BASE_WORK = 1 << 20;

/** The improved route, or null when no move improved it. */
export function refineRoute(
  items: ReadonlyArray<RouteItem>,
  refinement: RouteRefinement,
): RefinedRoute | null {
  if (items.length < 2 || !finiteRoute(items, refinement)) return null;
  const route = new Route(items, refinement);
  return route.refine() ? route.result() : null;
}

class Route {
  private readonly n: number;
  private readonly order: Int32Array;
  private readonly pos: Int32Array;
  private readonly flip: Uint8Array;
  private readonly symmetric: Uint8Array;
  private readonly neighbours: ReadonlyArray<Int32Array>;
  private readonly startNeighbours: Int32Array;
  private readonly budget: number;
  private work = 0;

  constructor(
    private readonly items: ReadonlyArray<RouteItem>,
    private readonly options: RouteRefinement,
  ) {
    this.n = items.length;
    this.order = Int32Array.from({ length: this.n }, (_, index) => index);
    this.pos = Int32Array.from({ length: this.n }, (_, index) => index);
    this.flip = new Uint8Array(this.n);
    this.symmetric = Uint8Array.from(items, (item) =>
      item.entry.x === item.exit.x && item.entry.y === item.exit.y ? 1 : 0,
    );
    const lists = neighbourLists(items, options.start);
    this.neighbours = lists.items;
    this.startNeighbours = lists.start;
    this.budget = WORK_PER_ITEM * this.n + BASE_WORK;
  }

  refine(): boolean {
    let changed = false;
    let improved = true;
    while (improved && this.work < this.budget) {
      improved = false;
      for (let position = 0; position < this.n && this.work < this.budget; position += 1) {
        if (this.twoOpt(position) || this.orOpt(position)) {
          improved = true;
          changed = true;
        }
      }
    }
    return changed;
  }

  result(): RefinedRoute {
    return { order: Array.from(this.order), flipped: Array.from(this.flip, (bit) => bit === 1) };
  }

  private entryOf(item: number): Vec2 {
    const value = this.items[item] as RouteItem;
    return this.flip[item] === 1 ? value.exit : value.entry;
  }

  private exitOf(item: number): Vec2 {
    const value = this.items[item] as RouteItem;
    return this.flip[item] === 1 ? value.entry : value.exit;
  }

  /** Where the head is before visiting `position`. */
  private before(position: number): Vec2 {
    return position === 0 ? this.options.start : this.exitOf(this.order[position - 1] as number);
  }

  /** Where the head goes after `position`; null for an unscored route end. */
  private after(position: number): Vec2 | null {
    return position === this.n - 1
      ? this.options.returnTo
      : this.entryOf(this.order[position + 1] as number);
  }

  private reversible(item: number): boolean {
    return this.symmetric[item] === 1 || (this.items[item] as RouteItem).flippable;
  }

  // Reverse a stretch starting or ending next to `i`, flipping every item in
  // it that is not symmetric.
  private twoOpt(i: number): boolean {
    if (this.options.pinFirst && i === 0) return false;
    return this.twoOptFrom(i) || this.twoOptUpTo(i);
  }

  // Reverse [i, j] for a j whose item neighbours the item before `i`.
  private twoOptFrom(i: number): boolean {
    const anchor = this.before(i);
    const candidates =
      i === 0 ? this.startNeighbours : (this.neighbours[this.order[i - 1] as number] as Int32Array);
    const first = this.order[i] as number;
    for (const candidate of candidates) {
      const j = this.pos[candidate] as number;
      if (j < i) continue;
      this.work += 1;
      const last = this.order[j] as number;
      const next = this.after(j);
      const delta =
        distance(anchor, this.exitOf(last)) +
        distance(this.entryOf(first), next) -
        distance(anchor, this.entryOf(first)) -
        distance(this.exitOf(last), next);
      if (!(delta < -IMPROVEMENT_MM) || !this.canReverse(i, j)) continue;
      this.reverse(i, j);
      return true;
    }
    return false;
  }

  // The mirrored move: bring a neighbour of the item at `i` up against it by
  // reversing the stretch from that neighbour to the item before `i`.
  private twoOptUpTo(i: number): boolean {
    const first = this.order[i] as number;
    const entry = this.entryOf(first);
    for (const candidate of this.neighbours[first] as Int32Array) {
      const j = this.pos[candidate] as number;
      if (j >= i || (this.options.pinFirst && j === 0)) continue;
      this.work += 1;
      const before = this.before(j);
      const last = this.order[i - 1] as number;
      const delta =
        distance(before, this.exitOf(last)) +
        distance(this.entryOf(candidate), entry) -
        distance(before, this.entryOf(candidate)) -
        distance(this.exitOf(last), entry);
      if (!(delta < -IMPROVEMENT_MM) || !this.canReverse(j, i - 1)) continue;
      this.reverse(j, i - 1);
      return true;
    }
    return false;
  }

  private canReverse(i: number, j: number): boolean {
    const holds = this.options.holds;
    for (let position = i; position <= j; position += 1) {
      const item = this.order[position] as number;
      this.work += 1;
      if (!this.reversible(item)) return false;
      for (const held of holds?.holds[item] ?? []) {
        this.work += 1;
        if ((this.pos[held] as number) <= j) return false;
      }
    }
    return true;
  }

  private reverse(i: number, j: number): void {
    for (let low = i, high = j; low < high; low += 1, high -= 1) {
      const a = this.order[low] as number;
      this.order[low] = this.order[high] as number;
      this.order[high] = a;
    }
    for (let position = i; position <= j; position += 1) {
      const item = this.order[position] as number;
      this.pos[item] = position;
      if (this.symmetric[item] === 0) this.flip[item] = this.flip[item] === 1 ? 0 : 1;
    }
    this.work += j - i + 1;
  }

  // Move the chunk starting at `i` (1 to MAX_CHUNK items) next to a neighbour
  // of either end, forwards or reversed.
  private orOpt(i: number): boolean {
    if (this.options.pinFirst && i === 0) return false;
    for (let length = 1; length <= MAX_CHUNK && i + length <= this.n; length += 1) {
      if (this.moveChunk(i, length)) return true;
    }
    return false;
  }

  private moveChunk(i: number, length: number): boolean {
    const end = i + length - 1;
    const first = this.order[i] as number;
    const last = this.order[end] as number;
    const prev = this.before(i);
    const next = this.after(end);
    const removed =
      distance(prev, this.entryOf(first)) +
      distance(this.exitOf(last), next) -
      distance(prev, next);
    const reversible = this.chunkReversible(i, end);
    for (const reversed of reversible ? [false, true] : [false]) {
      const chunk: Chunk = {
        i,
        end,
        removed,
        reversed,
        head: reversed ? last : first,
        tail: reversed ? first : last,
        entry: reversed ? this.exitOf(last) : this.entryOf(first),
        exit: reversed ? this.entryOf(first) : this.exitOf(last),
      };
      // After a neighbour of the chunk's new head, or before one of its tail.
      if (this.insertNear(chunk, this.neighbours[chunk.head] as Int32Array, 0)) return true;
      if (this.insertNear(chunk, this.neighbours[chunk.tail] as Int32Array, -1)) return true;
    }
    return false;
  }

  // Insert the chunk after position `pos[neighbour] + offset` for the first
  // neighbour where that shortens the route and keeps every hold.
  private insertNear(chunk: Chunk, neighbours: Int32Array, offset: 0 | -1): boolean {
    const { i, end } = chunk;
    for (const neighbour of neighbours) {
      const k = (this.pos[neighbour] as number) + offset;
      if ((k >= i - 1 && k <= end) || (this.options.pinFirst && k < 0)) continue;
      this.work += 1;
      const u = k < 0 ? this.options.start : this.exitOf(this.order[k] as number);
      const v =
        k === this.n - 1 ? this.options.returnTo : this.entryOf(this.order[k + 1] as number);
      const added = distance(u, chunk.entry) + distance(chunk.exit, v) - distance(u, v);
      if (!(added - chunk.removed < -IMPROVEMENT_MM) || !this.canMove(i, end, k)) continue;
      this.relocate(i, end - i + 1, k, chunk.reversed);
      return true;
    }
    return false;
  }

  private chunkReversible(i: number, end: number): boolean {
    for (let position = i; position <= end; position += 1) {
      const item = this.order[position] as number;
      if (!this.reversible(item)) return false;
      for (const held of this.options.holds?.holds[item] ?? []) {
        const at = this.pos[held] as number;
        if (at >= i && at <= end) return false;
      }
    }
    return true;
  }

  // Moving forwards past (end, k] must not pass an item the chunk holds back;
  // moving backwards past (k, i) must not pass one that holds the chunk back.
  private canMove(i: number, end: number, k: number): boolean {
    const holds = this.options.holds;
    if (holds === undefined || !holds.any) return true;
    for (let position = i; position <= end; position += 1) {
      const item = this.order[position] as number;
      const others = k > end ? holds.holds[item] : holds.heldBy[item];
      for (const other of others ?? []) {
        this.work += 1;
        const at = this.pos[other] as number;
        if (k > end ? at > end && at <= k : at > k && at < i) return false;
      }
    }
    return true;
  }

  private relocate(i: number, length: number, k: number, reversed: boolean): void {
    const chunk = Array.from(this.order.subarray(i, i + length));
    if (reversed) {
      chunk.reverse();
      for (const item of chunk) {
        if (this.symmetric[item] === 0) this.flip[item] = this.flip[item] === 1 ? 0 : 1;
      }
    }
    let from: number;
    let to: number;
    if (k > i + length - 1) {
      this.order.copyWithin(i, i + length, k + 1);
      this.order.set(chunk, k - length + 1);
      from = i;
      to = k;
    } else {
      this.order.copyWithin(k + 1 + length, k + 1, i);
      this.order.set(chunk, k + 1);
      from = k + 1;
      to = i + length - 1;
    }
    for (let position = from; position <= to; position += 1) {
      this.pos[this.order[position] as number] = position;
    }
    this.work += to - from + 1;
  }
}

function distance(a: Vec2, b: Vec2 | null): number {
  if (b === null) return 0;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function finiteRoute(items: ReadonlyArray<RouteItem>, refinement: RouteRefinement): boolean {
  const finite = (point: Vec2 | null): boolean =>
    point === null || (Number.isFinite(point.x) && Number.isFinite(point.y));
  return (
    finite(refinement.start) &&
    finite(refinement.returnTo) &&
    items.every((item) => finite(item.entry) && finite(item.exit))
  );
}
