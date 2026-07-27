import { describe, expect, it } from 'vitest';

import { createNearestEntryQuery, type SegmentEntry } from './segment-entry-index';

// An independent oracle, written the way the old inline scan in optimize-paths
// worked: walk every entry in order, keep the first that is strictly nearer.
// Deliberately NOT reusing the module's own comparator - a test that shares the
// implementation's logic cannot catch the implementation being wrong.
function referenceNearest(
  entries: ReadonlyArray<SegmentEntry>,
  cursor: { x: number; y: number },
  isAvailable: (segmentIndex: number) => boolean,
): SegmentEntry | null {
  let best: SegmentEntry | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    if (!isAvailable(entry.segmentIndex)) continue;
    const dx = entry.point.x - cursor.x;
    const dy = entry.point.y - cursor.y;
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      best = entry;
    }
  }
  return best;
}

// Mulberry32. The pure core bans randomness, but a test needs varied input and
// a fixed seed keeps it reproducible - a failure is always re-runnable.
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

function buildEntries(count: number, random: () => number, spread: number): SegmentEntry[] {
  const entries: SegmentEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    entries.push({
      point: { x: random() * spread, y: random() * spread },
      segmentIndex: i,
      reverse: false,
    });
    entries.push({
      point: { x: random() * spread, y: random() * spread },
      segmentIndex: i,
      reverse: true,
    });
  }
  return entries;
}

function same(a: SegmentEntry | null, b: SegmentEntry | null): boolean {
  if (a === null || b === null) return a === b;
  return a.segmentIndex === b.segmentIndex && a.reverse === b.reverse;
}

describe('createNearestEntryQuery', () => {
  it('returns the identical pick to an exhaustive scan across fuzzed inputs', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const random = seededRandom(seed);
      const entries = buildEntries(120, random, 300);
      const query = createNearestEntryQuery(entries);

      // Consume entries as the optimizer does, so availability shrinks over
      // time and later queries search a sparser grid.
      const taken = new Set<number>();
      const isAvailable = (segmentIndex: number): boolean => !taken.has(segmentIndex);
      let cursor = { x: 0, y: 0 };
      for (let step = 0; step < 120; step += 1) {
        const actual = query(cursor, isAvailable);
        const expected = referenceNearest(entries, cursor, isAvailable);
        expect(same(actual, expected), `seed ${seed} step ${step}`).toBe(true);
        if (actual === null) break;
        taken.add(actual.segmentIndex);
        cursor = actual.point;
      }
    }
  });

  it('breaks exact distance ties by lowest segment index, then forward before reversed', () => {
    // Four entries at the identical point: the old scan would have kept the
    // first it saw, which is segment 3 forward.
    const point = { x: 10, y: 10 };
    const entries: SegmentEntry[] = [
      { point, segmentIndex: 3, reverse: false },
      { point, segmentIndex: 3, reverse: true },
      { point, segmentIndex: 7, reverse: false },
      { point, segmentIndex: 9, reverse: true },
    ];
    const pick = createNearestEntryQuery(entries)({ x: 0, y: 0 }, () => true);
    expect(pick?.segmentIndex).toBe(3);
    expect(pick?.reverse).toBe(false);
  });

  it('skips unavailable segments entirely', () => {
    const entries: SegmentEntry[] = [
      { point: { x: 1, y: 0 }, segmentIndex: 0, reverse: false },
      { point: { x: 50, y: 0 }, segmentIndex: 1, reverse: false },
    ];
    const pick = createNearestEntryQuery(entries)({ x: 0, y: 0 }, (i) => i !== 0);
    expect(pick?.segmentIndex).toBe(1);
  });

  it('returns null when nothing is available and when there are no entries', () => {
    const entries: SegmentEntry[] = [{ point: { x: 1, y: 1 }, segmentIndex: 0, reverse: false }];
    expect(createNearestEntryQuery(entries)({ x: 0, y: 0 }, () => false)).toBeNull();
    expect(createNearestEntryQuery([])({ x: 0, y: 0 }, () => true)).toBeNull();
  });

  it('handles degenerate extents that would divide by a zero-sized cell', () => {
    const identical: SegmentEntry[] = Array.from({ length: 8 }, (_, i) => ({
      point: { x: 5, y: 5 },
      segmentIndex: i,
      reverse: false,
    }));
    expect(createNearestEntryQuery(identical)({ x: 0, y: 0 }, () => true)?.segmentIndex).toBe(0);

    const collinear: SegmentEntry[] = Array.from({ length: 40 }, (_, i) => ({
      point: { x: i, y: 0 },
      segmentIndex: i,
      reverse: false,
    }));
    const query = createNearestEntryQuery(collinear);
    expect(query({ x: 39.4, y: 0 }, () => true)?.segmentIndex).toBe(39);
    expect(query({ x: -100, y: 0 }, () => true)?.segmentIndex).toBe(0);
  });

  it('agrees with the exhaustive scan for cursors far outside the populated area', () => {
    const random = seededRandom(99);
    const entries = buildEntries(60, random, 50);
    const query = createNearestEntryQuery(entries);
    const cursors = [
      { x: -10_000, y: -10_000 },
      { x: 10_000, y: -10_000 },
      { x: 0, y: 10_000 },
      { x: 10_000, y: 25 },
    ];
    for (const cursor of cursors) {
      expect(
        same(
          query(cursor, () => true),
          referenceNearest(entries, cursor, () => true),
        ),
      ).toBe(true);
    }
  });

  it('falls back to an exhaustive scan when a coordinate is not finite', () => {
    // A NaN would poison every cell index, so the grid is refused outright and
    // the always-correct scan runs instead.
    const entries: SegmentEntry[] = [
      { point: { x: Number.NaN, y: 0 }, segmentIndex: 0, reverse: false },
      { point: { x: 3, y: 4 }, segmentIndex: 1, reverse: false },
    ];
    const pick = createNearestEntryQuery(entries)({ x: 0, y: 0 }, () => true);
    expect(pick?.segmentIndex).toBe(1);
  });
});
