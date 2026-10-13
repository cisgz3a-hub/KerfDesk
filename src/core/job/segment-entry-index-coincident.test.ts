import { describe, expect, it } from 'vitest';
import { createNearestEntryQuery, type SegmentEntry } from './segment-entry-index';

type Point = { readonly x: number; readonly y: number };

// Independent exhaustive ranking: no production grid, bucket, comparator or
// geometry helpers. Input ordinal is the final key when all semantic keys tie.
function oracle(entries: ReadonlyArray<SegmentEntry>, cursor: Point, retired: Set<number>) {
  const ranked = entries
    .map((entry, ordinal) => ({
      entry,
      keys: [
        (entry.point.x - cursor.x) ** 2 + (entry.point.y - cursor.y) ** 2,
        entry.segmentIndex,
        Number(entry.reverse),
        entry.vertexIndex ?? 0,
        ordinal,
      ],
    }))
    .filter(({ entry, keys }) => !retired.has(entry.segmentIndex) && Number.isFinite(keys[0]));
  ranked.sort((left, right) => {
    for (let index = 0; index < left.keys.length; index++) {
      const difference = (left.keys[index] ?? 0) - (right.keys[index] ?? 0);
      if (difference !== 0) return difference;
    }
    return 0;
  });
  return ranked[0]?.entry ?? null;
}

function entry(
  segmentIndex: number,
  point: Point,
  reverse = false,
  vertexIndex?: number,
): SegmentEntry {
  return { segmentIndex, point, reverse, ...(vertexIndex === undefined ? {} : { vertexIndex }) };
}

function randomFor(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1));
    const current = values[index] as T;
    values[index] = values[pick] as T;
    values[pick] = current;
  }
  return values;
}

describe('coincident segment entry lookup', () => {
  it('keeps shuffled coordinate duplicates, semantic tie order and original object identity', () => {
    const point = { x: 17, y: -3 };
    const entries = [
      entry(9, point),
      entry(2, point, true, 0),
      entry(2, point, false, 4),
      entry(2, point, false, 1),
      entry(2, point, false),
      entry(2, point, false, 0),
      entry(6, point),
    ];
    for (const ordered of [entries, [...entries].reverse()]) {
      const expected = oracle(ordered, point, new Set());
      const query = createNearestEntryQuery(ordered);
      expect(query(point, () => true)).toBe(expected);
      expect(query(point, (index) => index !== 2)).toBe(entries[6]);
      expect(query(point, (index) => index === 9)).toBe(entries[0]);
      expect(query(point, () => false)).toBeNull();
    }
  });

  it('does not consume a selected entry until availability retires its segment', () => {
    const entries = [entry(5, { x: 0, y: 0 }), entry(1, { x: 0, y: 0 })];
    const query = createNearestEntryQuery(entries);
    for (let repeat = 0; repeat < 25; repeat++) {
      expect(query({ x: repeat, y: -repeat }, () => true)).toBe(entries[1]);
    }
    expect(query({ x: 0, y: 0 }, (index) => index !== 1)).toBe(entries[0]);
    expect(query({ x: 0, y: 0 }, () => false)).toBeNull();
  });

  it('retires every entry of a segment across coordinate buckets without losing its peers', () => {
    const entries = [
      entry(4, { x: 0, y: 0 }),
      entry(4, { x: 100, y: 0 }, true),
      entry(1, { x: 0, y: 0 }),
      entry(1, { x: 100, y: 0 }, true),
      entry(7, { x: 0, y: 0 }),
      entry(7, { x: 100, y: 0 }, true),
    ];
    const retired = new Set<number>([4]);
    const query = createNearestEntryQuery(entries);
    for (const cursor of [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]) {
      const expected = oracle(entries, cursor, retired);
      expect(query(cursor, (index) => !retired.has(index))).toBe(expected);
      if (expected !== null) retired.add(expected.segmentIndex);
    }
    expect(query({ x: 0, y: 0 }, (index) => !retired.has(index))).toBeNull();
  });

  it('never rounds nearby distinct coordinates into one location', () => {
    const near = { x: 1 + Number.EPSILON, y: 2 };
    const entries = [
      entry(0, { x: 1, y: 2 }),
      entry(9, near),
      entry(2, { x: 1, y: 2 + Number.EPSILON * 2 }),
    ];
    const query = createNearestEntryQuery(entries);
    expect(query(near, () => true)).toBe(entries[1]);
    expect(query(entries[2]!.point, () => true)).toBe(entries[2]);
    expect(query(entries[0]!.point, () => true)).toBe(entries[0]);
  });

  it('keeps first-object identity on signed-zero and missing-versus-zero vertex ties', () => {
    const entries = [entry(2, { x: -0, y: 0 }), entry(2, { x: 0, y: -0 }, false, 0)];
    expect(createNearestEntryQuery(entries)({ x: 0, y: 0 }, () => true)).toBe(entries[0]);
    expect(createNearestEntryQuery([...entries].reverse())({ x: 0, y: 0 }, () => true)).toBe(
      entries[1],
    );
  });

  it.each([1, 2])(
    'uses linear availability work for 4096 paths at %i exact coordinate locations',
    (locations) => {
      const count = 4096;
      const entries: SegmentEntry[] = [];
      for (let index = count - 1; index >= 0; index--) {
        for (let point = 0; point < locations; point++) {
          entries.push(entry(index, { x: point * 100, y: 40 }, point === 1));
        }
      }
      const query = createNearestEntryQuery(entries);
      const retired = new Set<number>();
      let checked = 0;
      const available = (index: number) => {
        checked++;
        return !retired.has(index);
      };
      for (let index = 0; index < count; index++) {
        const picked = query({ x: (index % locations) * 100, y: 40 }, available);
        expect(picked?.segmentIndex).toBe(index);
        retired.add(index);
      }
      expect(query({ x: 0, y: 40 }, available)).toBeNull();
      // Count algorithmic work, not wall clock: each queued entry may be checked
      // live and again when retired, with slack for two searched locations.
      expect(checked).toBeLessThanOrEqual(8 * entries.length);
    },
  );

  it.each([17, 491, 20261013])(
    'matches a brute-force oracle through duplicate-heavy queries, seed %i',
    (seed) => {
      const random = randomFor(seed);
      const entries: SegmentEntry[] = [];
      for (let index = 0; index < 160; index++) {
        for (let vertex = 0; vertex < 4; vertex++) {
          entries.push(
            entry(
              index,
              { x: Math.floor(random() * 3), y: Math.floor(random() * 3) },
              vertex % 2 === 1,
              Math.floor(random() * 3),
            ),
          );
        }
      }
      shuffle(entries, random);
      const originalOrder = [...entries];
      for (const item of entries) {
        Object.freeze(item.point);
        Object.freeze(item);
      }
      Object.freeze(entries);
      const query = createNearestEntryQuery(entries);
      const retired = new Set<number>();
      for (let step = 0; step < 160; step++) {
        const cursor = { x: Math.floor(random() * 5) - 1, y: Math.floor(random() * 5) - 1 };
        const expected = oracle(entries, cursor, retired);
        const available = (index: number) => !retired.has(index);
        expect(query(cursor, available)).toBe(expected);
        expect(query(cursor, available)).toBe(expected);
        if (expected !== null) retired.add(expected.segmentIndex);
      }
      expect(query({ x: 1, y: 1 }, (index) => !retired.has(index))).toBeNull();
      entries.forEach((item, index) => expect(item).toBe(originalOrder[index]));
    },
  );
});
