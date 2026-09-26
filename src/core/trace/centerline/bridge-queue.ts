// Gap bridging merges, one at a time, the closest bridgeable pair of open
// chain ends, ties going to the pair that comes first in chain order (each
// chain's start before its end). Rescanning every end after each merge made
// that quadratic in the number of ends. A merge changes only the two chains
// it joins — every other pair keeps its gap and its verdict — so this queue
// holds every bridgeable pair once, drops the joined chains' pairs when they
// merge and measures the surviving chain's two ends afresh. It returns the
// same pairs, in the same order, as the rescan.

import type { Vec2 } from '../../scene';
import type { TraceSteps } from '../trace-steps';

type BridgeChain = { points: Vec2[]; closed: boolean; alive: boolean };
export type BridgeEnd<C> = { readonly chain: C; readonly atStart: boolean };
/** The gap of a bridgeable pair, or null when the pair may not bridge. */
export type BridgeGap<C> = (a: BridgeEnd<C>, b: BridgeEnd<C>) => number | null;

type Candidate<C> = {
  readonly gap: number;
  readonly first: number;
  readonly second: number;
  readonly a: BridgeEnd<C>;
  readonly b: BridgeEnd<C>;
  readonly versionA: number;
  readonly versionB: number;
};

export class BridgeQueue<C extends BridgeChain> {
  private readonly rank = new Map<C, number>();
  private readonly version = new Map<C, number>();
  private readonly heap: Candidate<C>[] = [];
  private readonly cells = new Map<number, C[]>();
  private readonly cellSize: number;
  private gridded: boolean;

  /** `reach`: no bridgeable pair is this far apart or farther. */
  constructor(
    private readonly chains: ReadonlyArray<C>,
    reach: number,
    private readonly gapOf: BridgeGap<C>,
  ) {
    chains.forEach((chain, index) => {
      this.rank.set(chain, index);
      this.version.set(chain, 0);
    });
    this.cellSize = Math.max(1, reach);
    this.gridded = reach > 0 && Number.isFinite(reach);
    for (const chain of chains) if (isOpen(chain)) this.file(chain);
  }

  /** Measure every pair once. */
  *measureAllSteps(): TraceSteps<void> {
    const cooperate = yield;
    for (const chain of this.chains) {
      if (cooperate) yield;
      if (!isOpen(chain)) continue;
      this.measureFrom({ chain, atStart: true }, true);
      this.measureFrom({ chain, atStart: false }, true);
    }
  }

  /** The next pair to bridge, or null when none remains. */
  take(): readonly [BridgeEnd<C>, BridgeEnd<C>] | null {
    for (let next = this.pop(); next !== undefined; next = this.pop()) {
      if (this.current(next)) return [next.a, next.b];
    }
    return null;
  }

  /** `survivor` absorbed `absorbed`: re-measure the survivor's ends. */
  merged(survivor: C, absorbed: C): void {
    this.bump(survivor);
    this.bump(absorbed);
    if (!isOpen(survivor)) return;
    this.file(survivor);
    this.measureFrom({ chain: survivor, atStart: true }, false);
    this.measureFrom({ chain: survivor, atStart: false }, false);
  }

  private measureFrom(end: BridgeEnd<C>, laterOnly: boolean): void {
    const own = this.key(end);
    for (const chain of this.near(endPoint(end))) {
      if (chain === end.chain) continue;
      for (const atStart of [true, false]) {
        const other = { chain, atStart };
        const key = this.key(other);
        if (laterOnly && key < own) continue;
        const [a, b] = key < own ? [other, end] : [end, other];
        const gap = this.gapOf(a, b);
        if (gap !== null) this.push(this.candidate(gap, a, b));
      }
    }
  }

  private candidate(gap: number, a: BridgeEnd<C>, b: BridgeEnd<C>): Candidate<C> {
    return {
      gap,
      first: this.key(a),
      second: this.key(b),
      a,
      b,
      versionA: this.version.get(a.chain) ?? 0,
      versionB: this.version.get(b.chain) ?? 0,
    };
  }

  private current(candidate: Candidate<C>): boolean {
    const { a, b } = candidate;
    return (
      isOpen(a.chain) &&
      isOpen(b.chain) &&
      this.version.get(a.chain) === candidate.versionA &&
      this.version.get(b.chain) === candidate.versionB
    );
  }

  private key(end: BridgeEnd<C>): number {
    return (this.rank.get(end.chain) ?? 0) * 2 + (end.atStart ? 0 : 1);
  }

  private bump(chain: C): void {
    this.version.set(chain, (this.version.get(chain) ?? 0) + 1);
  }

  // Open chains filed near a point: every chain with an end within one cell
  // (a superset of those within reach). Without a usable grid, every chain.
  private near(point: Vec2 | undefined): Iterable<C> {
    if (!this.gridded || point === undefined) return this.chains.filter(isOpen);
    const cx = this.cell(point.x);
    const cy = this.cell(point.y);
    const found = new Set<C>();
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const chain of this.cells.get(cellKey(cx + dx, cy + dy)) ?? []) {
          if (isOpen(chain)) found.add(chain);
        }
      }
    }
    return found;
  }

  private file(chain: C): void {
    for (const point of [chain.points[0], chain.points.at(-1)]) {
      if (point === undefined) continue;
      const cx = this.cell(point.x);
      const cy = this.cell(point.y);
      if (!safeCell(cx) || !safeCell(cy)) {
        this.gridded = false;
        return;
      }
      const key = cellKey(cx, cy);
      const bucket = this.cells.get(key);
      if (bucket === undefined) this.cells.set(key, [chain]);
      else if (bucket.at(-1) !== chain) bucket.push(chain);
    }
  }

  private cell(coordinate: number): number {
    return Math.floor(coordinate / this.cellSize);
  }

  private push(candidate: Candidate<C>): void {
    const heap = this.heap;
    let child = heap.length;
    heap.push(candidate);
    while (child > 0) {
      const parent = (child - 1) >> 1;
      const above = heap[parent] as Candidate<C>;
      if (!before(candidate, above)) break;
      heap[child] = above;
      child = parent;
    }
    heap[child] = candidate;
  }

  private pop(): Candidate<C> | undefined {
    const heap = this.heap;
    const top = heap[0];
    const last = heap.pop();
    if (top === undefined || last === undefined || heap.length === 0) return top;
    let parent = 0;
    for (;;) {
      const left = parent * 2 + 1;
      if (left >= heap.length) break;
      const right = left + 1;
      const child =
        right < heap.length && before(heap[right] as Candidate<C>, heap[left] as Candidate<C>)
          ? right
          : left;
      if (!before(heap[child] as Candidate<C>, last)) break;
      heap[parent] = heap[child] as Candidate<C>;
      parent = child;
    }
    heap[parent] = last;
    return top;
  }
}

// Smaller gap first; equal gaps keep the rescan's first-found pair.
function before<C>(p: Candidate<C>, q: Candidate<C>): boolean {
  if (p.gap !== q.gap) return p.gap < q.gap;
  if (p.first !== q.first) return p.first < q.first;
  return p.second < q.second;
}

function isOpen(chain: BridgeChain): boolean {
  return chain.alive && !chain.closed && chain.points.length >= 2;
}

function endPoint<C extends BridgeChain>(end: BridgeEnd<C>): Vec2 | undefined {
  return end.atStart ? end.chain.points[0] : end.chain.points.at(-1);
}

function safeCell(cell: number): boolean {
  return Number.isSafeInteger(cell) && Math.abs(cell) < Number.MAX_SAFE_INTEGER;
}

// Distinct for every cell of a trace-sized grid; a collision only adds
// candidates, which are measured anyway.
function cellKey(cx: number, cy: number): number {
  return cx * 0x400000 + cy;
}
