import type { Vec2 } from '../../scene';

type IndexedChain = {
  readonly points: ReadonlyArray<Vec2>;
  readonly closed: boolean;
  readonly alive: boolean;
};

/**
 * Chains filed under the unit grid cells of their end points, so the chains
 * that end near a point are found without scanning every chain. A chain is
 * re-filed when its ends move; an out-of-date filing is harmless because a
 * lookup only narrows the candidates and the caller re-tests the chain's
 * current ends.
 */
export class ChainEndIndex<C extends IndexedChain> {
  private readonly cells = new Map<number, C[]>();
  private readonly order = new Map<C, number>();

  /** `reach`: the widest per-axis distance a caller treats as the same point. */
  constructor(
    chains: ReadonlyArray<C>,
    private readonly reach: number,
  ) {
    chains.forEach((chain, index) => {
      this.order.set(chain, index);
      this.file(chain);
    });
  }

  /** File a chain under its current end points. */
  file(chain: C): void {
    const first = chain.points[0];
    const last = chain.points.at(-1);
    if (first !== undefined) this.fileAt(chain, first);
    if (last !== undefined && last !== first) this.fileAt(chain, last);
  }

  /** Live open chains with an end filed within reach of `pos`, in the
   *  order of the chain array the index was built from. */
  near(pos: Vec2): C[] {
    // No end can match a non-finite point.
    if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return [];
    const found = new Set<C>();
    const reach = this.reach * 2;
    for (let cx = Math.floor(pos.x - reach); cx <= Math.floor(pos.x + reach); cx += 1) {
      for (let cy = Math.floor(pos.y - reach); cy <= Math.floor(pos.y + reach); cy += 1) {
        for (const chain of this.cells.get(cellKey(cx, cy)) ?? []) {
          if (chain.alive && !chain.closed) found.add(chain);
        }
      }
    }
    return [...found].sort((a, b) => (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0));
  }

  private fileAt(chain: C, p: Vec2): void {
    const key = cellKey(Math.floor(p.x), Math.floor(p.y));
    const bucket = this.cells.get(key);
    if (bucket === undefined) this.cells.set(key, [chain]);
    else if (bucket.at(-1) !== chain) bucket.push(chain);
  }
}

// Distinct for any trace-sized grid; a collision only adds candidates.
function cellKey(cx: number, cy: number): number {
  return cx * 0x200000 + cy;
}
