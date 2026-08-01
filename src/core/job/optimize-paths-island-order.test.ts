// Island fill GROUP ordering — proof that indexing the pick did not change it.
//
// The exhaustive scan this replaces (pickBestIslandGroup) is re-implemented
// here FROM SCRATCH: it is neither imported nor built on the index's own
// comparator. A test that shares the implementation's logic cannot catch the
// implementation being wrong, which is why the merged segment-entry-index and
// containment-depth work used this same pattern — and it caught a real bug.

import { describe, expect, it } from 'vitest';

import type { Vec2 } from '../scene';
import type { FillGroup, FillSegment, Group, Job } from './job';
import { optimizePaths } from './optimize-paths';

type Endpoints = { readonly entry: Vec2; readonly exit: Vec2 };

// The old scan, rewritten from its observable behaviour: walk the remaining
// groups in ascending index, keep the first whose entry is strictly nearer,
// then advance the cursor to the picked group's EXIT. Availability shrinks as
// groups are consumed, so later steps search a sparser set — the condition
// under which an index can diverge from a scan.
function referenceIslandOrder(endpoints: ReadonlyArray<Endpoints>, start: Vec2): number[] {
  const remaining = new Set<number>();
  for (let i = 0; i < endpoints.length; i += 1) remaining.add(i);
  const order: number[] = [];
  let cursor = start;
  while (remaining.size > 0) {
    let best: number | null = null;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (const i of remaining) {
      const point = (endpoints[i] as Endpoints).entry;
      const dx = point.x - cursor.x;
      const dy = point.y - cursor.y;
      const distSq = dx * dx + dy * dy;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = i;
      }
    }
    if (best === null) break;
    remaining.delete(best);
    order.push(best);
    cursor = (endpoints[best] as Endpoints).exit;
  }
  return order;
}

// Mulberry32. The pure core bans randomness; a test needs varied input and a
// fixed seed keeps every failure re-runnable.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The endpoint model these fixtures rely on: for an island group holding one
// two-point sweep with overscanMm 0, no runway policy and reverse false,
// islandGroupEndpoints reduces to entry = polyline[0], exit = polyline[1].
// Derivation — groupFillScanlines yields one span oriented along the run;
// legacyPlan's runway is effectiveFillOverscanMm(…, 0, 'island') = 0;
// shiftedScanSweepEndpoints is a no-op when reverse is false; and
// expandFillHatchWithRunways with zero leads returns the burn endpoints
// unchanged. "pins the endpoint model" below fails loudly if that stops
// holding, so the fuzz can never quietly compare the wrong points.
function islandGroup(entry: Vec2, exit: Vec2): FillGroup {
  const segment: FillSegment = { polyline: [entry, exit], closed: false, reverse: false };
  return {
    kind: 'fill',
    layerId: 'L1',
    color: '#000',
    power: 50,
    speed: 1000,
    passes: 1,
    airAssist: false,
    fillStyle: 'island',
    overscanMm: 0,
    segments: [segment],
  };
}

function endpointsOf(groups: ReadonlyArray<FillGroup>): Endpoints[] {
  return groups.map((group) => {
    const polyline = (group.segments[0] as FillSegment).polyline;
    return { entry: polyline[0] as Vec2, exit: polyline[1] as Vec2 };
  });
}

function actualOrder(groups: ReadonlyArray<FillGroup>): number[] {
  const indexOf = new Map<Group, number>(groups.map((group, i) => [group, i]));
  const job: Job = { groups: [...groups] };
  return optimizePaths(job).groups.map((group) => indexOf.get(group) ?? -1);
}

// Even seeds snap to an integer lattice so exact distance ties actually occur —
// the only case where "same pick" and "equally near" differ, and so the only
// case that can break byte-identical G-code. Odd seeds stay on floats, where
// ties are vanishingly rare but the grid geometry is exercised harder.
function fuzzGroups(count: number, seed: number): FillGroup[] {
  const random = seededRandom(seed);
  const snap = seed % 2 === 0;
  const spread = snap ? 24 : 300;
  const coord = (): number => {
    const value = random() * spread;
    return snap ? Math.floor(value) : value;
  };
  return Array.from({ length: count }, () => {
    const entry = { x: coord(), y: coord() };
    // A zero-length sweep yields no endpoints at all, which would take the
    // whole run down the source-order fallback and test nothing.
    return islandGroup(entry, { x: entry.x + 1, y: entry.y + 1 });
  });
}

function travelDistance(endpoints: ReadonlyArray<Endpoints>, order: ReadonlyArray<number>): number {
  let cursor: Vec2 = { x: 0, y: 0 };
  let total = 0;
  for (const index of order) {
    const endpoint = endpoints[index] as Endpoints;
    total += Math.hypot(endpoint.entry.x - cursor.x, endpoint.entry.y - cursor.y);
    cursor = endpoint.exit;
  }
  return total;
}

describe('island fill group ordering', () => {
  it('pins the endpoint model: a group is entered at its sweep start and left at its end', () => {
    // If the cursor advanced to the ENTRY instead of the EXIT, the group at
    // (10,0) would be picked second (10mm from (0,0)) rather than the group at
    // (60,0) (10mm from the real exit at (50,0)). The two orders differ, so
    // this discriminates rather than merely passing.
    const groups = [
      islandGroup({ x: 0, y: 0 }, { x: 50, y: 0 }),
      islandGroup({ x: 60, y: 0 }, { x: 61, y: 0 }),
      islandGroup({ x: 10, y: 0 }, { x: 11, y: 0 }),
    ];
    expect(actualOrder(groups)).toEqual([0, 1, 2]);
  });

  it('matches an independently written exhaustive scan across fuzzed inputs', () => {
    for (let seed = 1; seed <= 24; seed += 1) {
      const groups = fuzzGroups(120, seed);
      const expected = referenceIslandOrder(endpointsOf(groups), { x: 0, y: 0 });
      expect(actualOrder(groups), `seed ${seed}`).toEqual(expected);
    }
  });

  it('breaks an exact distance tie by the lower group index, as the scan did', () => {
    // Identical entry points, and (3,4)/(5,0) are both exactly 5 from the
    // origin. An "equally near" answer would be free to pick either; a
    // byte-identical one is not.
    const groups = [
      islandGroup({ x: 3, y: 4 }, { x: 3, y: 5 }),
      islandGroup({ x: 5, y: 0 }, { x: 5, y: 1 }),
      islandGroup({ x: 3, y: 4 }, { x: 3, y: 6 }),
    ];
    expect(actualOrder(groups)).toEqual([0, 2, 1]);
  });

  it('orders island fill groups far above the former 2,000-group ceiling', () => {
    // MAX_ISLAND_FILL_GROUP_REORDER returned this input in source order with no
    // travel recovered and no signal to the operator. It is the same defect the
    // per-segment cap had, one level up.
    const groups = fuzzGroups(3_000, 7);
    const endpoints = endpointsOf(groups);
    const order = actualOrder(groups);

    expect(order).toHaveLength(3_000);
    expect(order).toEqual(referenceIslandOrder(endpoints, { x: 0, y: 0 }));
    const sourceOrder = order.map((_, i) => i);
    expect(order).not.toEqual(sourceOrder);
    expect(travelDistance(endpoints, order)).toBeLessThan(
      travelDistance(endpoints, sourceOrder) / 2,
    );
  });

  it('is deterministic — the same oversized input yields the same order twice', () => {
    // Non-negotiable #5. Above the old ceiling this held trivially, because
    // nothing was reordered; now that the optimizer runs, it needs asserting.
    const groups = fuzzGroups(2_500, 12);
    expect(actualOrder(groups)).toEqual(actualOrder(groups));
  });

  it('leaves a run in source order when a group has no computable endpoints', () => {
    // A zero-length sweep produces no endpoints, so it can never be picked.
    // The old scan skipped it and fell back to source order; contributing no
    // index entry has to reach the same place.
    const degenerate = islandGroup({ x: 40, y: 0 }, { x: 40, y: 0 });
    const groups = [islandGroup({ x: 90, y: 0 }, { x: 91, y: 0 }), degenerate];
    expect(actualOrder(groups)).toEqual([0, 1]);
  });
});
