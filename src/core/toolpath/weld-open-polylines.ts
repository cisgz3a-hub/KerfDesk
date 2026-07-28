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
import { WELD_COINCIDENT_EPS, weldPairs, type WeldWorkChain } from './weld-pairs';

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
// Match the established Centerline 35-degree continuity convention over a
// fixed physical neighborhood instead of a transform-dependent pixel count.
const WELD_TANGENT_SAMPLE_MM = 0.3;

/** Weld fragmented open polylines for machine execution. Pure and
 *  deterministic; closed rings and degenerate chains pass through. */
export function weldOpenPolylines(
  polylines: ReadonlyArray<Polyline>,
  options: WeldOpenPolylinesOptions,
): Polyline[] {
  if (!Number.isFinite(options.mmPerPx) || options.mmPerPx <= 0) return [...polylines];
  const maxGapPx = options.maxGapMm / options.mmPerPx;
  const tangentSamplePx = WELD_TANGENT_SAMPLE_MM / options.mmPerPx;
  const passthrough = polylines.flatMap((polyline, order) =>
    polyline.closed || polyline.points.length < 2 ? [{ polyline, order }] : [],
  );
  const open = polylines.flatMap<WeldWorkChain>((polyline, order) =>
    polyline.closed || polyline.points.length < 2
      ? []
      : [{ points: [...polyline.points], order, hasMerged: false }],
  );
  const pairing = weldPairs(open, maxGapPx, tangentSamplePx);
  const welded = pairing.chains.map((chain) => ({
    polyline: selfClose(chain, maxGapPx, tangentSamplePx),
    order: chain.order,
  }));
  const ordered = [...passthrough, ...welded].reduce<
    ReadonlyArray<{ readonly polyline: Polyline; readonly order: number }>
  >((entries, entry) => insertByOrder(entries, entry), []);
  return ordered.map((entry) => entry.polyline);
}

// Close a welded chain whose ends meet: gap within the weld threshold AND
// small next to the chain length. The closure appends an exact copy of the
// start so the ring conforms to the explicit-return convention (renderers
// and emitters draw points as given).
function selfClose(chain: WeldWorkChain, maxGapPx: number, tangentSamplePx: number): Polyline {
  if (!chain.hasMerged) return { points: chain.points, closed: false };
  const first = chain.points[0];
  const last = chain.points.at(-1);
  if (first === undefined || last === undefined) return { points: chain.points, closed: false };
  const gap = Math.hypot(last.x - first.x, last.y - first.y);
  const length = chainLength(chain.points);
  const hasContinuousClosure =
    gap <= WELD_COINCIDENT_EPS ||
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
    gap <= WELD_COINCIDENT_EPS ? chain.points : [...chain.points, { x: first.x, y: first.y }];
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

function insertByOrder<Entry extends { readonly order: number }>(
  entries: ReadonlyArray<Entry>,
  entry: Entry,
): ReadonlyArray<Entry> {
  const index = entries.findIndex((candidate) => entry.order < candidate.order);
  return index < 0
    ? [...entries, entry]
    : [...entries.slice(0, index), entry, ...entries.slice(index)];
}
