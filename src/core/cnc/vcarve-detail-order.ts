// orderDetailBySliver — sliver-major ordering for thin-detail rings
// (ADR-279 follow-up).
//
// Detail rings arrive step-major from the fine ladder: every sliver's ring 1,
// then every sliver's ring 2. Emitting that order hops the cutter between
// slivers once per fine step — dozens of cross-glyph travels on script text.
// Grouping by owning sliver first (stable, fine steps still ascending within
// a sliver) keeps the cutter inside one stroke until it is finished — the
// same promise ADR-270 makes for regions, one level down.

import { pointInPolygon } from '../geometry';
import type { Polyline } from '../scene';
import type { OrderedVCarvePolyline } from './vcarve-region-order';

export function orderDetailBySliver(
  entries: ReadonlyArray<OrderedVCarvePolyline>,
  sliverRoots: ReadonlyArray<Polyline>,
): ReadonlyArray<OrderedVCarvePolyline> {
  if (sliverRoots.length <= 1 || entries.length <= 1) return entries;
  const indexed = entries.map((entry, order) => ({
    entry,
    order,
    sliver: owningSliver(entry.polyline, sliverRoots),
  }));
  // Stable: sliver ascending, then the original fine-step order within it.
  return [...indexed]
    .sort((a, b) => (a.sliver === b.sliver ? a.order - b.order : a.sliver - b.sliver))
    .map(({ entry }) => entry);
}

// A ring belongs to the first sliver root containing its probe point; a ring
// no root claims (degenerate probe) sorts after every real sliver unmoved.
function owningSliver(polyline: Polyline, roots: ReadonlyArray<Polyline>): number {
  const probe = polyline.points[0];
  if (probe === undefined) return roots.length;
  const index = roots.findIndex((root) => pointInPolygon(probe, root.points));
  return index < 0 ? roots.length : index;
}
