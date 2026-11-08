// Only new explicitly scoped Jobs enter this planner. Historical nesting alone never opts in.
import type { ProjectOptimizationSettings, Vec2 } from '../scene';
import type { Origin } from '../devices';
import { directionalSegmentOrder, sweepKey, sweepOrder as sweepIndices } from './directional-order';
import {
  insideFirstHolds,
  releaseHolds,
  waitingCounts,
  type InsideFirstHolds,
} from './inside-first-holds';
import type { CutGroup, CutSegment, FillGroup, Group } from './job';
import { refineRoute } from './route-refine';
import { polylineBounds, type SegmentBounds } from './segment-bounds';
import {
  collectSegmentEntries,
  configuredSegmentOrder,
  startCursorForSegments,
} from './segment-order';
import { createNearestEntryQuery } from './segment-entry-index';
import { removeCutOverlaps } from './remove-cut-overlaps';
import { containmentDepths } from './containment-depth';
import { cleanupTopologyRoute, mergedOutlines, type PlannedCutPart } from './topology-cut-cleanup';
import { minOf } from '../util';

type Settings = Pick<ProjectOptimizationSettings, 'insideFirst' | 'pathDirection' | 'startPoint'> &
  Partial<
    Pick<
      ProjectOptimizationSettings,
      'closedShapeStart' | 'removeOverlappingLines' | 'overlapMergeToleranceMm' | 'cutDirection'
    >
  > & { readonly origin?: Origin };
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
    segments:
      settings.cutDirection !== undefined && cursor === null
        ? directionalSegmentOrder(group.segments, {
            direction: settings.cutDirection,
            origin: settings.origin ?? 'front-left',
            insideFirst: settings.insideFirst,
            allowsReverse: settings.pathDirection === 'allow-reverse',
          })
        : configuredSegmentOrder(group.segments, settings, cursor ?? undefined, {
            returnTo: startCursorForSegments(group.segments, settings.startPoint),
            pinFirst: cursor !== null,
          }),
  };
  return settings.removeOverlappingLines === true
    ? removeCutOverlaps(ordered, settings.overlapMergeToleranceMm ?? 0)
    : ordered;
}

// Part by part (ADR-669): a packet is ready once no deeper packet inside its
// bounds is waiting, then the nearest (or next-in-sweep) ready packet is cut.
// The nearest-neighbour route is refined as whole packets, each keeping the
// passes and contour route it was planned with.
function planPacketRoute(
  packets: ReadonlyArray<Packet>,
  origins: ReadonlyMap<CutGroup, CutGroup>,
  settings: Settings,
  lineCursor: Vec2 | null,
): PlannedCutPart[] {
  const seed = startCursorForSegments(packets.flatMap(packetSegments), settings.startPoint);
  const start = lineCursor ?? seed;
  const holds = packetHolds(packets);
  const planned = routePackets(packets, origins, settings, lineCursor, start, holds);
  const blocks =
    planned ??
    routePackets(packets, origins, settings, lineCursor, start, undefined) ??
    ([] as PlannedCutPart[][]);
  const sweeps = settings.cutDirection !== undefined && lineCursor === null;
  if (planned === null || sweeps) return blocks.flat();
  return refineBlocks(blocks, start, seed, lineCursor !== null, holds).flat();
}

type PlannedBlock = PlannedCutPart[] & { readonly packet?: number };

// One block of planned parts per packet, in visiting order. With holds, null
// when a held packet was left unplaced; without, the former depth-major route.
function routePackets(
  packets: ReadonlyArray<Packet>,
  origins: ReadonlyMap<CutGroup, CutGroup>,
  settings: Settings,
  lineCursor: Vec2 | null,
  start: Vec2,
  holds: InsideFirstHolds | undefined,
): PlannedBlock[] | null {
  let cursor = start;
  const blocks: PlannedBlock[] = [];
  const placed = new Set<number>();
  const subsets =
    holds === undefined
      ? [...new Set(packets.map((packet) => packet.depth))]
          .sort((a, b) => b - a)
          .map((depth) =>
            packets.flatMap((packet, index) => (packet.depth === depth ? [index] : [])),
          )
      : [packets.map((_, index) => index)];
  for (const members of subsets) {
    const next = packetPicker(packets, members, settings, lineCursor, holds);
    for (let pick = next(cursor); pick !== undefined; pick = next(cursor)) {
      placed.add(pick);
      const packet = packets[pick];
      if (packet === undefined) continue;
      const block: PlannedCutPart[] = [];
      // Group passes stay intact: all main passes finish before this parent's low-power passes.
      for (const group of [...packet.main, ...packet.tabs]) {
        const segments = configuredSegmentOrder(
          group.segments,
          { ...settings, insideFirst: packet.original },
          cursor,
        );
        block.push({
          group: { ...group, segments },
          source: origins.get(group) ?? group,
          depth: packet.depth,
          withoutTabs: !packet.original && packet.tabs.length === 0,
        });
        cursor = segments.at(-1)?.polyline.at(-1) ?? cursor;
      }
      blocks.push(Object.assign(block, { packet: pick }));
    }
  }
  // A packet without a usable entry is never placed, as before ADR-669; one
  // that was also held back may have left its container waiting.
  const stalled =
    holds !== undefined &&
    packets.some((_, index) => !placed.has(index) && (holds.heldBy[index]?.length ?? 0) > 0);
  return stalled ? null : blocks;
}

// Packets that cut something inside a shallower packet's bounds hold it back.
// A packet of original (open) segments encloses nothing.
function packetHolds(packets: ReadonlyArray<Packet>): InsideFirstHolds {
  return insideFirstHolds(
    packets.map((packet) => {
      const members = packetSegments(packet).map((segment) => polylineBounds(segment.polyline));
      return {
        depth: packet.depth,
        container: packet.original ? null : unionBounds(members),
        members,
      };
    }),
  );
}

function unionBounds(boxes: ReadonlyArray<SegmentBounds | null>): SegmentBounds | null {
  let union: SegmentBounds | null = null;
  for (const box of boxes) {
    if (box === null) continue;
    union =
      union === null
        ? box
        : {
            minX: Math.min(union.minX, box.minX),
            minY: Math.min(union.minY, box.minY),
            maxX: Math.max(union.maxX, box.maxX),
            maxY: Math.max(union.maxY, box.maxY),
          };
  }
  return union;
}

// The next packet among `members`: in the Cut direction sweep when one is set
// (and no Line burn start), otherwise the nearest ready entry to the head.
function packetPicker(
  packets: ReadonlyArray<Packet>,
  members: ReadonlyArray<number>,
  settings: Settings,
  lineCursor: Vec2 | null,
  holds: InsideFirstHolds | undefined,
): (cursor: Vec2) => number | undefined {
  const subset = members.map((index) => packets[index] as Packet);
  const sweep = sweepOrder(subset, settings, lineCursor, holds);
  if (sweep !== null) {
    let next = 0;
    return () => members[sweep[next++] ?? -1];
  }
  const nearest = createNearestEntryQuery(
    members.flatMap((index) =>
      collectSegmentEntries(packetSegments(packets[index] as Packet), {
        allowsReverse: settings.pathDirection === 'allow-reverse',
        closedShapeStart: settings.closedShapeStart ?? 'drawn',
      }).map((entry) => ({ ...entry, segmentIndex: index })),
    ),
  );
  const placed = new Set<number>();
  const waiting = holds?.any === true ? waitingCounts(holds) : null;
  const isEligible = waiting === null ? undefined : (index: number) => waiting[index] === 0;
  return (cursor) => {
    const pick = nearest(cursor, (index) => !placed.has(index), isEligible)?.segmentIndex;
    if (pick === undefined) return undefined;
    placed.add(pick);
    if (waiting !== null && holds !== undefined) releaseHolds(holds, waiting, pick);
    return pick;
  };
}

// With a Cut direction (and no Line burn start), packets run in the sweep
// instead of nearest first. Null keeps the nearest-first route. `holds` is
// indexed like `peers` (all packets, or none for a depth subset).
function sweepOrder(
  peers: ReadonlyArray<Packet>,
  settings: Settings,
  lineCursor: Vec2 | null,
  holds: InsideFirstHolds | undefined,
): number[] | null {
  if (settings.cutDirection === undefined || lineCursor !== null) return null;
  const key = sweepKey(settings.cutDirection, settings.origin ?? 'front-left');
  const keys = peers.map((packet) => minOf(packetSegments(packet).map(key)));
  return sweepIndices(keys, holds?.holds.length === peers.length ? holds : undefined);
}

// Reorders whole packet blocks; each keeps its parts, passes and contour route.
function refineBlocks(
  blocks: ReadonlyArray<PlannedBlock>,
  start: Vec2,
  returnTo: Vec2,
  pinFirst: boolean,
  holds: InsideFirstHolds,
): ReadonlyArray<PlannedBlock> {
  const ends = blocks.map((block) => {
    const segments = block.flatMap((part) => part.group.segments);
    return { entry: segments[0]?.polyline[0], exit: segments.at(-1)?.polyline.at(-1) };
  });
  if (ends.some((end) => end.entry === undefined || end.exit === undefined)) return blocks;
  const position = new Map(blocks.map((block, at) => [block.packet, at]));
  const remap = (list: ReadonlyArray<number>): number[] =>
    list.flatMap((packet) => {
      const at = position.get(packet);
      return at === undefined ? [] : [at];
    });
  const refined = refineRoute(
    ends.map((end) => ({ entry: end.entry as Vec2, exit: end.exit as Vec2, flippable: false })),
    {
      start,
      returnTo,
      pinFirst,
      ...(holds.any
        ? {
            holds: {
              holds: blocks.map((block) => remap(holds.holds[block.packet ?? -1] ?? [])),
              heldBy: blocks.map((block) => remap(holds.heldBy[block.packet ?? -1] ?? [])),
              any: true,
            },
          }
        : {}),
    },
  );
  return refined === null ? blocks : refined.order.map((at) => blocks[at] as PlannedBlock);
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
        ...mergedOutlines(previous, part.group),
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
