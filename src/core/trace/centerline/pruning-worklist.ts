import type { Vec2 } from '../../scene';

export type MutablePruneChain = {
  a: number;
  b: number;
  points: Vec2[];
  closed: boolean;
  alive: boolean;
};

/** Revisit only chains whose endpoint degree or geometry changed, while
 * retaining the original full scan's first-chain order. */
export class PruningWorklist {
  private readonly heap: number[] = [];
  private readonly queued = new Set<number>();
  private readonly rank = new Map<MutablePruneChain, number>();
  private readonly incident = new Map<number, Set<MutablePruneChain>>();

  constructor(private readonly chains: ReadonlyArray<MutablePruneChain>) {
    chains.forEach((chain, index) => {
      this.rank.set(chain, index);
      this.heap.push(index); // increasing indices already form a min-heap
      this.queued.add(index);
      this.attach(chain);
    });
  }

  take(): MutablePruneChain | undefined {
    const index = this.heap[0];
    const last = this.heap.pop();
    if (index === undefined || last === undefined) return undefined;
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.siftDown();
    }
    this.queued.delete(index);
    return this.chains[index];
  }

  attach(chain: MutablePruneChain): void {
    if (!chain.alive || chain.closed) return;
    for (const node of [chain.a, chain.b]) {
      const chains = this.incident.get(node) ?? new Set<MutablePruneChain>();
      chains.add(chain);
      this.incident.set(node, chains);
    }
  }

  detach(chain: MutablePruneChain): void {
    this.incident.get(chain.a)?.delete(chain);
    this.incident.get(chain.b)?.delete(chain);
  }

  changedAt(node: number): void {
    for (const chain of this.incident.get(node) ?? []) this.enqueue(chain);
  }

  at(node: number): MutablePruneChain[] {
    return [...(this.incident.get(node) ?? [])].sort(
      (a, b) => (this.rank.get(a) ?? 0) - (this.rank.get(b) ?? 0),
    );
  }

  private enqueue(chain: MutablePruneChain): void {
    const index = this.rank.get(chain);
    if (index === undefined || this.queued.has(index)) return;
    this.queued.add(index);
    let seat = this.heap.length;
    this.heap.push(index);
    while (seat > 0) {
      const parent = Math.floor((seat - 1) / 2);
      const value = this.heap[parent];
      if (value === undefined || value <= index) break;
      this.heap[seat] = value;
      seat = parent;
    }
    this.heap[seat] = index;
  }

  private siftDown(): void {
    let seat = 0;
    for (;;) {
      const left = 2 * seat + 1;
      const right = left + 1;
      const child = (this.heap[right] ?? Infinity) < (this.heap[left] ?? Infinity) ? right : left;
      const current = this.heap[seat];
      const next = this.heap[child];
      if (current === undefined || next === undefined || current <= next) return;
      this.heap[seat] = next;
      this.heap[child] = current;
      seat = child;
    }
  }
}
