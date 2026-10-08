// Cleanup follows a route already chosen from complete parent contours. It
// compares each original process group once, then keeps its fragment traversal.
import type { CutGroup, CutSegment } from './job';
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
  return route.flatMap((part) => {
    const segments = retained.get(part) ?? [];
    return segments.length === 0 ? [] : [{ ...part, group: { ...part.group, segments } }];
  });
}
