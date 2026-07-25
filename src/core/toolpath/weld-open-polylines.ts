// Machine-facing weld for fragmented open polylines (CNC chatter audit
// candidate fix 3, 2026-07-25). A traced stroke that arrives in pieces —
// scan cracks and dropouts leave endpoint gaps wider than the tracer's own
// 3 px bridge — costs a retract -> reposition -> plunge cycle per piece on
// CNC (pecking), and every fragment boundary is a full stop. This pass
// joins open chains whose endpoints lie within a physical gap and closes a
// welded loop that returns to its start. It NEVER deletes geometry: a
// standalone short chain (a drawn dot or tick) and anything beyond the gap
// (dashes are drawn content) pass through untouched, as do closed rings.

import type { Polyline, Vec2 } from '../scene';

export type WeldOpenPolylinesOptions = {
  /** Physical size of one polyline unit (trace pixel), mm. Non-finite or
   *  non-positive disables the pass (input returned unchanged). */
  readonly mmPerPx: number;
  /** Endpoint gaps at or under this weld; anything wider is drawn space. */
  readonly maxGapMm: number;
};

// A welded chain only self-closes when the remaining gap is small next to
// the loop itself — the same proportionality idea as the tracer's loop
// closure; a short open arc must not be stapled into a sliver ring.
const MAX_CLOSE_GAP_FRACTION = 0.25;
const COINCIDENT_EPS = 1e-9;

type WorkChain = {
  points: Vec2[];
  /** Smallest original index among merged members — keeps output order
   *  stable and deterministic. */
  order: number;
};

/** Weld fragmented open polylines for machine execution. Pure and
 *  deterministic; closed rings and degenerate chains pass through. */
export function weldOpenPolylines(
  polylines: ReadonlyArray<Polyline>,
  options: WeldOpenPolylinesOptions,
): Polyline[] {
  if (!Number.isFinite(options.mmPerPx) || options.mmPerPx <= 0) return [...polylines];
  const maxGapPx = options.maxGapMm / options.mmPerPx;
  const passthrough: Array<{ readonly polyline: Polyline; readonly order: number }> = [];
  const open: WorkChain[] = [];
  polylines.forEach((polyline, index) => {
    if (polyline.closed || polyline.points.length < 2) {
      passthrough.push({ polyline, order: index });
      return;
    }
    open.push({ points: [...polyline.points], order: index });
  });
  weldPairs(open, maxGapPx);
  const welded = open.map((chain) => ({
    polyline: selfClose(chain, maxGapPx),
    order: chain.order,
  }));
  return [...passthrough, ...welded]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.polyline);
}

// Greedy nearest-pair welding: repeatedly join the two chains with the
// smallest endpoint gap at or under the threshold. Ties break on the lower
// chain indices, then on the pairing order — fully deterministic.
function weldPairs(chains: WorkChain[], maxGapPx: number): void {
  for (;;) {
    const best = bestPair(chains, maxGapPx);
    if (best === null) return;
    const a = chains[best.i] as WorkChain;
    const b = chains[best.j] as WorkChain;
    // Orient A to END at the matched endpoint and B to START at it.
    if (best.aEnd === 'start') a.points.reverse();
    if (best.bEnd === 'end') b.points.reverse();
    const tail = a.points[a.points.length - 1] as Vec2;
    const head = b.points[0] as Vec2;
    const coincident = Math.hypot(tail.x - head.x, tail.y - head.y) <= COINCIDENT_EPS;
    a.points.push(...(coincident ? b.points.slice(1) : b.points));
    a.order = Math.min(a.order, b.order);
    chains.splice(best.j, 1);
  }
}

type PairMatch = {
  readonly i: number;
  readonly j: number;
  readonly aEnd: 'start' | 'end';
  readonly bEnd: 'start' | 'end';
  readonly dist: number;
};

function bestPair(chains: ReadonlyArray<WorkChain>, maxGapPx: number): PairMatch | null {
  let best: PairMatch | null = null;
  for (let i = 0; i < chains.length; i += 1) {
    for (let j = i + 1; j < chains.length; j += 1) {
      for (const aEnd of ['start', 'end'] as const) {
        for (const bEnd of ['start', 'end'] as const) {
          const pa = endpointOf(chains[i] as WorkChain, aEnd);
          const pb = endpointOf(chains[j] as WorkChain, bEnd);
          const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (dist > maxGapPx) continue;
          if (best === null || dist < best.dist) {
            best = { i, j, aEnd, bEnd, dist };
          }
        }
      }
    }
  }
  return best;
}

function endpointOf(chain: WorkChain, end: 'start' | 'end'): Vec2 {
  return (end === 'start' ? chain.points[0] : chain.points[chain.points.length - 1]) as Vec2;
}

// Close a welded chain whose ends meet: gap within the weld threshold AND
// small next to the chain length. The closure appends an exact copy of the
// start so the ring conforms to the explicit-return convention (renderers
// and emitters draw points as given).
function selfClose(chain: WorkChain, maxGapPx: number): Polyline {
  const first = chain.points[0] as Vec2;
  const last = chain.points[chain.points.length - 1] as Vec2;
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const length = chainLength(chain.points);
  if (gap > maxGapPx || gap > length * MAX_CLOSE_GAP_FRACTION) {
    return { points: chain.points, closed: false };
  }
  const points =
    gap <= COINCIDENT_EPS ? chain.points : [...chain.points, { x: first.x, y: first.y }];
  return { points, closed: true };
}

function chainLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1] as Vec2;
    const b = points[i] as Vec2;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
