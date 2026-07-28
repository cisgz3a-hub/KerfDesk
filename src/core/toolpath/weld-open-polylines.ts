// Machine-facing weld for fragmented open polylines (CNC chatter audit
// candidate fix 3, 2026-07-25). A traced stroke that arrives in pieces —
// scan cracks and dropouts leave endpoint gaps wider than the tracer's own
// 3 px bridge — costs a retract -> reposition -> plunge cycle per piece on
// CNC (pecking), and every fragment boundary is a full stop. This pass
// joins open chains only when nearby endpoints also form a continuous stroke,
// and closes a welded loop that returns continuously to its start. It NEVER
// deletes geometry: a standalone short chain (a drawn dot or tick), a nearby
// independent stroke, and anything beyond the gap (dashes are drawn content)
// pass through untouched, as do closed rings.

import type { Polyline, Vec2 } from '../scene';
import { isWeldEndpointContinuous } from './is-weld-endpoint-continuous';

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
// Match the established Centerline 35-degree continuity convention over a
// fixed physical neighborhood instead of a transform-dependent pixel count.
const WELD_TANGENT_SAMPLE_MM = 0.3;

type PolylineEnd = 'start' | 'end';
const POLYLINE_ENDS: ReadonlyArray<PolylineEnd> = ['start', 'end'];

type WorkChain = {
  points: Vec2[];
  /** Smallest original index among merged members — keeps output order
   *  stable and deterministic. */
  order: number;
  hasMerged: boolean;
};

type ChainPair = readonly [WorkChain, WorkChain];

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
    open.push({ points: [...polyline.points], order: index, hasMerged: false });
  });
  weldPairs(open, maxGapPx, WELD_TANGENT_SAMPLE_MM / options.mmPerPx);
  const welded = open.map((chain) => ({
    polyline: selfClose(chain, maxGapPx, WELD_TANGENT_SAMPLE_MM / options.mmPerPx),
    order: chain.order,
  }));
  return [...passthrough, ...welded]
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.polyline);
}

// Greedy nearest-pair welding: repeatedly join the two chains with the
// smallest continuous endpoint gap at or under the threshold. Ties break on
// the lower chain indices, then on the pairing order — fully deterministic.
function weldPairs(chains: WorkChain[], maxGapPx: number, tangentSamplePx: number): void {
  for (;;) {
    const best = bestPair(chains, maxGapPx, tangentSamplePx);
    if (best === null) return;
    const a = chains[best.i];
    const b = chains[best.j];
    if (a === undefined || b === undefined) return;
    // Orient A to END at the matched endpoint and B to START at it.
    if (best.aEnd === 'start') a.points.reverse();
    if (best.bEnd === 'end') b.points.reverse();
    const tail = a.points.at(-1);
    const head = b.points[0];
    if (tail === undefined || head === undefined) return;
    const coincident = Math.hypot(tail.x - head.x, tail.y - head.y) <= COINCIDENT_EPS;
    a.points.push(...(coincident ? b.points.slice(1) : b.points));
    a.order = Math.min(a.order, b.order);
    a.hasMerged = true;
    chains.splice(best.j, 1);
  }
}

type PairMatch = {
  readonly i: number;
  readonly j: number;
  readonly aEnd: PolylineEnd;
  readonly bEnd: PolylineEnd;
  readonly dist: number;
};

function bestPair(
  chains: ReadonlyArray<WorkChain>,
  maxGapPx: number,
  tangentSamplePx: number,
): PairMatch | null {
  let best: PairMatch | null = null;
  for (let i = 0; i < chains.length; i += 1) {
    for (let j = i + 1; j < chains.length; j += 1) {
      const pair = chainPairAt(chains, i, j);
      if (pair === null) continue;
      const [a, b] = pair;
      for (const aEnd of POLYLINE_ENDS) {
        for (const bEnd of POLYLINE_ENDS) {
          const pa = endpointOf(a, aEnd);
          const pb = endpointOf(b, bEnd);
          if (pa === undefined || pb === undefined) continue;
          const dist = Math.hypot(pa.x - pb.x, pa.y - pb.y);
          if (dist > maxGapPx) continue;
          if (
            !isWeldEndpointContinuous({
              aPoints: a.points,
              aEnd,
              bPoints: b.points,
              bEnd,
              tangentSamplePx,
            })
          ) {
            continue;
          }
          if (best === null || dist < best.dist) {
            best = { i, j, aEnd, bEnd, dist };
          }
        }
      }
    }
  }
  return best;
}

function chainPairAt(
  chains: ReadonlyArray<WorkChain>,
  firstIndex: number,
  secondIndex: number,
): ChainPair | null {
  const first = chains[firstIndex];
  const second = chains[secondIndex];
  return first === undefined || second === undefined ? null : [first, second];
}

function endpointOf(chain: WorkChain, end: PolylineEnd): Vec2 | undefined {
  return end === 'start' ? chain.points[0] : chain.points.at(-1);
}

// Close a welded chain whose ends meet: gap within the weld threshold AND
// small next to the chain length. The closure appends an exact copy of the
// start so the ring conforms to the explicit-return convention (renderers
// and emitters draw points as given).
function selfClose(chain: WorkChain, maxGapPx: number, tangentSamplePx: number): Polyline {
  if (!chain.hasMerged) return { points: chain.points, closed: false };
  const first = endpointOf(chain, 'start');
  const last = endpointOf(chain, 'end');
  if (first === undefined || last === undefined) return { points: chain.points, closed: false };
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const length = chainLength(chain.points);
  const hasContinuousClosure =
    gap <= COINCIDENT_EPS ||
    isWeldEndpointContinuous({
      aPoints: chain.points,
      aEnd: 'end',
      bPoints: chain.points,
      bEnd: 'start',
      tangentSamplePx,
    });
  if (gap > maxGapPx || gap > length * MAX_CLOSE_GAP_FRACTION || !hasContinuousClosure) {
    return { points: chain.points, closed: false };
  }
  const points =
    gap <= COINCIDENT_EPS ? chain.points : [...chain.points, { x: first.x, y: first.y }];
  return { points, closed: true };
}

function chainLength(points: ReadonlyArray<Vec2>): number {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a === undefined || b === undefined) continue;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}
