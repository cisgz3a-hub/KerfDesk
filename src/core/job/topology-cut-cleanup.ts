// Cleanup follows a route already chosen from complete parent contours. It
// compares each original process group once, then keeps its fragment traversal.
import type { CutGroup, CutSegment, CutTopologyRing } from './job';
import { removeCutOverlaps } from './remove-cut-overlaps';

export type PlannedCutPart = {
  readonly group: CutGroup;
  readonly source: CutGroup;
  readonly depth: number;
  readonly withoutTabs: boolean;
};
// An ephemeral splitter identity distinguishes original-open depth packets
// without inventing closed parents. It is stripped from EVERY retained piece.
const ROUTE_PART = Symbol('topology-cleanup-route-part');
type RoutedSegment = CutSegment & { readonly [ROUTE_PART]: number };

export function cleanupTopologyRoute(
  route: ReadonlyArray<PlannedCutPart>,
  toleranceMm: number,
): PlannedCutPart[] {
  const bySource = new Map<CutGroup, PlannedCutPart[]>();
  for (const part of route) {
    const parts = bySource.get(part.source) ?? [];
    parts.push(part);
    bySource.set(part.source, parts);
  }
  const retained = new Map<PlannedCutPart, CutSegment[]>();
  const outlines = new Map<CutGroup, CutTopologyRing[]>();
  for (const [source, parts] of bySource) {
    const cleaned = removeCutOverlaps(
      {
        ...source,
        segments: parts.flatMap((part, index) =>
          part.group.segments.map(
            (segment): RoutedSegment => ({ ...segment, [ROUTE_PART]: index }),
          ),
        ),
      },
      toleranceMm,
    );
    const split = newOutlines(source, cleaned);
    if (split.length > 0) outlines.set(source, split);
    for (const piece of cleaned.segments) {
      // Both exact and tolerance splitters preserve enumerable properties via
      // spreads, including unchanged native arc and original-open segments.
      const { [ROUTE_PART]: index, ...segment } = piece as RoutedSegment;
      const part = parts[index];
      if (part === undefined) throw new Error('Cut cleanup lost its planned route identity');
      const segments = retained.get(part) ?? [];
      segments.push(segment);
      retained.set(part, segments);
    }
  }
  // The outlines of contours the cleanup split (ADR-626 Amendment 8) ride on
  // the first part of their source that still cuts something.
  const placed = new Set<CutGroup>();
  return route.flatMap((part) => {
    const segments = retained.get(part) ?? [];
    if (segments.length === 0) return [];
    const split = placed.has(part.source) ? [] : (outlines.get(part.source) ?? []);
    placed.add(part.source);
    const group =
      split.length === 0
        ? { ...part.group, segments }
        : {
            ...part.group,
            segments,
            topologyRings: [...(part.group.topologyRings ?? []), ...split],
          };
    return [{ ...part, group }];
  });
}

/** Outlines removeCutOverlaps kept for contours it split, beyond the source's. */
function newOutlines(source: CutGroup, cleaned: CutGroup): CutTopologyRing[] {
  const known = new Set((source.topologyRings ?? []).map(outlineKey));
  return (cleaned.topologyRings ?? []).filter((ring) => !known.has(outlineKey(ring)));
}

function outlineKey(ring: CutTopologyRing): string {
  return `${ring.forest}\u0000${ring.contour}`;
}

/** Two groups' kept outlines, each once (for parts joined into one group). */
export function mergedOutlines(first: CutGroup, second: CutGroup): Pick<CutGroup, 'topologyRings'> {
  if (second.topologyRings === undefined) return {};
  const known = new Set((first.topologyRings ?? []).map(outlineKey));
  const added = second.topologyRings.filter((ring) => !known.has(outlineKey(ring)));
  return added.length === 0 ? {} : { topologyRings: [...(first.topologyRings ?? []), ...added] };
}
