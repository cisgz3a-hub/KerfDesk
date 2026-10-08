// Only new explicitly scoped Jobs enter this planner. Historical nesting alone never opts in.
import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import type { CutGroup, CutSegment, FillGroup, Group } from './job';
import {
  collectSegmentEntries,
  configuredSegmentOrder,
  startCursorForSegments,
} from './segment-order';
import { createNearestEntryQuery } from './segment-entry-index';
import { removeCutOverlaps } from './remove-cut-overlaps';
import { containmentDepths } from './containment-depth';
import { cleanupTopologyRoute, type PlannedCutPart } from './topology-cut-cleanup';

type Settings = Pick<ProjectOptimizationSettings, 'insideFirst' | 'pathDirection' | 'startPoint'> &
  Partial<
    Pick<
      ProjectOptimizationSettings,
      'closedShapeStart' | 'removeOverlappingLines' | 'overlapMergeToleranceMm'
    >
  >;
type Packet = {
  readonly depth: number;
  readonly main: CutGroup[];
  readonly tabs: CutGroup[];
  readonly original: boolean;
};
export type TopologyOrdering = {
  readonly groups: ReadonlyArray<Group>;
  readonly orderedCuts: ReadonlySet<CutGroup>;
};

export function orderTopologyScopes(
  groups: ReadonlyArray<Group>,
  settings: Settings,
  lineCursor: Vec2 | null,
): TopologyOrdering {
  const out: Group[] = [];
  const orderedCuts = new Set<CutGroup>();
  let index = 0;
  while (index < groups.length) {
    const first = groups[index];
    if (!isScopedParentCut(first)) {
      if (first !== undefined) out.push(first);
      index++;
      continue;
    }
    const run: Group[] = [];
    while (index < groups.length) {
      const next = groups[index];
      if (!belongsToScope(next, first.topologyScope)) break;
      run.push(next);
      index++;
    }
    const cuts = run.filter((group): group is CutGroup => group.kind === 'cut');
    const planned = orderCutPackets(cuts, settings, lineCursor);
    planned.forEach((group) => orderedCuts.add(group));
    // Preserve non-Line anchors within the same vector run while cut slots take the new packets.
    let nextCut = 0;
    const lastCut = run.reduce((last, group, at) => (group.kind === 'cut' ? at : last), -1);
    run.forEach((group, at) => {
      if (group.kind !== 'cut') {
        out.push(group);
        return;
      }
      const capacity = at === lastCut ? planned.length - nextCut : contourCount(group);
      for (let count = 0; count < capacity && nextCut < planned.length; count++) {
        const cut = planned[nextCut++];
        if (cut !== undefined) out.push(cut);
      }
    });
  }
  return { groups: out, orderedCuts };
}

type ScopedParentCut = CutGroup & { readonly topologyScope: string };
function isScopedParentCut(group: Group | undefined): group is ScopedParentCut {
  return (
    group?.kind === 'cut' &&
    group.topologyScope !== undefined &&
    group.segments.some((segment) => segment.nesting?.topologyContour !== undefined)
  );
}
function belongsToScope(group: Group | undefined, scope: string): group is CutGroup | FillGroup {
  return (group?.kind === 'cut' || group?.kind === 'fill') && group.topologyScope === scope;
}

function orderCutPackets(
  groups: ReadonlyArray<CutGroup>,
  settings: Settings,
  lineCursor: Vec2 | null,
): CutGroup[] {
  const lineSettings = lineStartSettings(settings, lineCursor);
  const single = singlePassGroup(groups);
  if (single !== undefined) return [orderSinglePass(single, lineSettings, lineCursor)];
  const { packets, origins } = collectPackets(groups);
  const route = planPacketRoute(packets, origins, lineSettings, lineCursor);
  const cleaned =
    settings.removeOverlappingLines === true
      ? cleanupTopologyRoute(route, settings.overlapMergeToleranceMm ?? 0)
      : route;
  return coalescePeerParts(cleaned);
}

function lineStartSettings(settings: Settings, cursor: Vec2 | null): Settings {
  return cursor === null
    ? settings
    : {
        ...settings,
        closedShapeStart:
          settings.closedShapeStart === 'nearest-corner' ? 'nearest-corner' : 'nearest',
      };
}
function singlePassGroup(groups: ReadonlyArray<CutGroup>): CutGroup | undefined {
  const first = groups[0];
  return groups.length === 1 && first?.passes === 1 && first.tabSpanPowerPercent === undefined
    ? first
    : undefined;
}
function orderSinglePass(group: CutGroup, settings: Settings, cursor: Vec2 | null): CutGroup {
  // Order originals once: newly split endpoints never compete with this route.
  const ordered = {
    ...group,
    segments: configuredSegmentOrder(group.segments, settings, cursor ?? undefined),
  };
  return settings.removeOverlappingLines === true
    ? removeCutOverlaps(ordered, settings.overlapMergeToleranceMm ?? 0)
    : ordered;
}

function planPacketRoute(
  packets: ReadonlyArray<Packet>,
  origins: ReadonlyMap<CutGroup, CutGroup>,
  settings: Settings,
  lineCursor: Vec2 | null,
): PlannedCutPart[] {
  const all = packets.flatMap(packetSegments);
  let cursor = lineCursor ?? startCursorForSegments(all, settings.startPoint);
  const depths = [...new Set(packets.map((packet) => packet.depth))].sort((a, b) => b - a);
  const route: PlannedCutPart[] = [];
  for (const depth of depths) {
    const peers = packets.filter((packet) => packet.depth === depth);
    const nearest = createNearestEntryQuery(
      peers.flatMap((packet, index) =>
        collectSegmentEntries(packetSegments(packet), {
          allowsReverse: settings.pathDirection === 'allow-reverse',
          closedShapeStart: settings.closedShapeStart ?? 'drawn',
        }).map((entry) => ({ ...entry, segmentIndex: index })),
      ),
    );
    const placed = new Set<number>();
    for (;;) {
      const pick = nearest(cursor, (index) => !placed.has(index));
      if (pick === null) break;
      placed.add(pick.segmentIndex);
      const packet = peers[pick.segmentIndex];
      if (packet === undefined) continue;
      // Group passes stay intact: all main passes finish before this parent's low-power passes.
      for (const group of [...packet.main, ...packet.tabs]) {
        const segments = configuredSegmentOrder(
          group.segments,
          { ...settings, insideFirst: packet.original },
          cursor,
        );
        route.push({
          group: { ...group, segments },
          source: origins.get(group) ?? group,
          depth,
          withoutTabs: !packet.original && packet.tabs.length === 0,
        });
        cursor = segments.at(-1)?.polyline.at(-1) ?? cursor;
      }
    }
  }
  return route;
}

function coalescePeerParts(route: ReadonlyArray<PlannedCutPart>): CutGroup[] {
  const out: CutGroup[] = [];
  let last: PlannedCutPart | undefined;
  for (const part of route) {
    const previous = out.at(-1);
    // Peers without a bridge barrier retain their original combined headers
    // and passes. Process groups never merge merely because power repeats.
    if (
      part.withoutTabs &&
      last?.withoutTabs &&
      previous !== undefined &&
      part.source === last.source &&
      part.depth === last.depth
    )
      out[out.length - 1] = {
        ...previous,
        segments: [...previous.segments, ...part.group.segments],
      };
    else out.push(part.group);
    last = part;
  }
  return out;
}

function collectPackets(groups: ReadonlyArray<CutGroup>): {
  packets: Packet[];
  origins: ReadonlyMap<CutGroup, CutGroup>;
} {
  const origins = new Map<CutGroup, CutGroup>();
  const packets = new Map<string, Packet>();
  groups.forEach((group, groupIndex) => {
    const contours = new Map<string, CutSegment[]>();
    const originalDepths = group.segments.some(
      (segment) => segment.nesting?.topologyContour === undefined,
    )
      ? containmentDepths(group.segments)
      : [];
    const contourDepths = new Map<string, number>();
    group.segments.forEach((segment, index) => {
      const marked = segment.nesting?.topologyContour;
      const depth =
        marked === undefined ? (originalDepths[index] ?? 0) : (segment.nesting?.depth ?? 0);
      const id = marked ?? `original:${groupIndex}:${depth}`;
      const list = contours.get(id) ?? [];
      list.push(segment);
      contours.set(id, list);
      contourDepths.set(id, depth);
    });
    for (const [id, segments] of contours) {
      const packet = packets.get(id) ?? {
        depth: contourDepths.get(id) ?? 0,
        main: [],
        tabs: [],
        original: id.startsWith('original:'),
      };
      const part = { ...group, segments };
      origins.set(part, group);
      if (group.tabSpanPowerPercent === undefined) packet.main.push(part);
      else packet.tabs.push(part);
      packets.set(id, packet);
    }
  });
  return { packets: [...packets.values()], origins };
}

function packetSegments(packet: Packet): ReadonlyArray<CutSegment> {
  return (packet.main.length > 0 ? packet.main : packet.tabs).flatMap((group) => group.segments);
}

function contourCount(group: CutGroup): number {
  return Math.max(
    1,
    new Set(group.segments.map((segment) => segment.nesting?.topologyContour ?? 'original')).size,
  );
}
