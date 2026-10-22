// What laser leads did to each operation's contours, for Job Review (ADR-626
// clause 9, Amendments 1, 2 and 8): how many got a shorter lead or lost one,
// and how many got none because their scrap side is unknown.

import type { JobDiagnostic } from './job';
import type { LeadSideVerdict } from './laser-lead-sides';

export type LeadCounts = {
  readonly layerName: string;
  shortened: number;
  omitted: number;
  /** Contours left without leads because their scrap side is unknown, by
   * the operation whose shape, or whose open lines, hold them: each must be
   * looked at. */
  readonly sideUnknown: Map<string, SideUnknownTally>;
};

type SideUnknownTally = {
  readonly aroundName: string;
  readonly aroundOpenPaths: boolean;
  count: number;
};

/** By operation id: two operations can share a name (each parent's Sub-layer 1). */
export function countsFor(
  counts: Map<string, LeadCounts>,
  layerId: string,
  name: string,
): LeadCounts {
  const existing = counts.get(layerId);
  if (existing !== undefined) return existing;
  const created = { layerName: name, shortened: 0, omitted: 0, sideUnknown: new Map() };
  counts.set(layerId, created);
  return created;
}

/** One count per holding operation, and apart for its open lines: the
 * warning says what to do about each. */
export function countSideUnknown(tally: LeadCounts, verdict: LeadSideVerdict): void {
  const aroundName = verdict.aroundName ?? '';
  const aroundOpenPaths = verdict.aroundOpenPaths === true;
  const key = `${aroundOpenPaths ? 'open' : 'closed'}\u0000${aroundName}`;
  const known = tally.sideUnknown.get(key);
  if (known === undefined) tally.sideUnknown.set(key, { aroundName, aroundOpenPaths, count: 1 });
  else known.count += 1;
}

export function leadDiagnostics(counts: ReadonlyMap<string, LeadCounts>): JobDiagnostic[] {
  return [...counts.entries()].flatMap(([layerId, tally]): JobDiagnostic[] => [
    ...(tally.shortened > 0 || tally.omitted > 0
      ? [
          {
            kind: 'laser-leads-adjusted' as const,
            layerId,
            layerName: tally.layerName,
            shortened: tally.shortened,
            omitted: tally.omitted,
          },
        ]
      : []),
    ...[...tally.sideUnknown.values()].map(({ aroundName, aroundOpenPaths, count }) => ({
      kind: 'laser-leads-side-unknown' as const,
      layerId,
      layerName: tally.layerName,
      count,
      aroundName,
      ...(aroundOpenPaths ? { aroundOpenPaths: true as const } : {}),
    })),
  ]);
}
