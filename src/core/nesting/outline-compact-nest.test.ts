import { describe, expect, it } from 'vitest';
import {
  compactOutlineNest,
  isOutlineNestWithinWorkBudget,
  outlineNest,
  type OutlineNestItem,
} from './outline-compact-nest';
import type { NestPlacement, NestRect } from './quick-nest';

const bin: NestRect = { minX: 0, minY: 0, maxX: 100, maxY: 60 };

describe('compactOutlineNest', () => {
  it('interlocks complementary triangles that rectangular packing keeps apart', () => {
    const items: OutlineNestItem[] = [
      item('upper', [
        [0, 0],
        [40, 0],
        [0, 40],
      ]),
      item('lower', [
        [40, 40],
        [40, 0],
        [0, 40],
      ]),
    ];
    const compacted = compactOutlineNest(bin, items, sideBySide(items), { padding: 0 });
    expect(compacted).toEqual([
      { id: 'upper', x: 0, y: 0, rotated90: false },
      { id: 'lower', x: 0, y: 0, rotated90: false },
    ]);
  });

  it('succeeds when the parts bounding rectangles cannot both fit', () => {
    const items: OutlineNestItem[] = [
      item('upper', [
        [0, 0],
        [40, 0],
        [0, 40],
      ]),
      item('lower', [
        [40, 40],
        [40, 0],
        [0, 40],
      ]),
    ];
    const result = outlineNest({ minX: 0, minY: 0, maxX: 40, maxY: 40 }, items, {
      padding: 0,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.placements).toEqual([
      { id: 'lower', x: 0, y: 0, rotated90: false },
      { id: 'upper', x: 0, y: 0, rotated90: false },
    ]);
    expect(result.usedOutline).toBe(true);
  });

  it('places a small part inside a ring while preserving the ring hole', () => {
    const ring: OutlineNestItem = {
      id: 'ring',
      width: 40,
      height: 40,
      canRotate: true,
      outline: [
        points([
          [0, 0],
          [40, 0],
          [40, 40],
          [0, 40],
        ]),
        points([
          [10, 10],
          [10, 30],
          [30, 30],
          [30, 10],
        ]),
      ],
    };
    const insert = item(
      'insert',
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      10,
      10,
    );
    const compacted = compactOutlineNest(
      bin,
      [ring, insert],
      [
        { id: 'ring', x: 0, y: 0, rotated90: false },
        { id: 'insert', x: 40, y: 0, rotated90: false },
      ],
      { padding: 0 },
    );
    expect(compacted[1]).toEqual({ id: 'insert', x: 15, y: 15, rotated90: false });
  });

  it('is deterministic and respects padding, rotation, and locked obstacles', () => {
    const items = [
      item(
        'A',
        [
          [0, 0],
          [30, 0],
          [0, 20],
        ],
        30,
        20,
      ),
      item(
        'B',
        [
          [0, 0],
          [20, 0],
          [20, 30],
          [0, 30],
        ],
        20,
        30,
      ),
    ];
    const placements: NestPlacement[] = [
      { id: 'A', x: 32, y: 2, rotated90: false },
      { id: 'B', x: 64, y: 2, rotated90: true },
    ];
    const options = {
      padding: 2,
      obstacles: [{ minX: 0, minY: 0, maxX: 30, maxY: 60 }],
    };
    const first = compactOutlineNest(bin, items, placements, options);
    expect(first).toEqual(compactOutlineNest(bin, items, placements, options));
    expect(first.every((placement) => placement.x >= 31)).toBe(true);
    expect(first[1]?.rotated90).toBe(true);
  });

  it('keeps the requested edge-to-edge clearance after compaction', () => {
    const items = [
      item(
        'A',
        [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10],
        ],
        20,
        10,
      ),
      item(
        'B',
        [
          [0, 0],
          [20, 0],
          [20, 10],
          [0, 10],
        ],
        20,
        10,
      ),
    ];
    const result = outlineNest(bin, items, { padding: 2 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ordered = [...result.placements].sort((left, right) => left.x - right.x);
    expect((ordered[1]?.x ?? 0) - (ordered[0]?.x ?? 0)).toBeGreaterThanOrEqual(22);
  });

  it('uses conservative rectangles for missing or invalid outlines', () => {
    const items: OutlineNestItem[] = [
      { id: 'raster-a', width: 30, height: 20, canRotate: false },
      { id: 'raster-b', width: 30, height: 20, canRotate: false, outline: [[]] },
    ];
    const compacted = compactOutlineNest(bin, items, sideBySide(items), { padding: 0 });
    expect(Math.abs((compacted[0]?.x ?? 0) - (compacted[1]?.x ?? 0))).toBeGreaterThanOrEqual(30);
  });

  it('falls back without expensive outline work above the bounded corpus size', () => {
    const items = Array.from({ length: 33 }, (_, index) =>
      item(
        String(index),
        [
          [0, 0],
          [1, 0],
          [0, 1],
        ],
        1,
        1,
      ),
    );
    const placements = items.map((entry, index) => ({
      id: entry.id,
      x: index,
      y: 0,
      rotated90: false,
    }));
    expect(compactOutlineNest({ ...bin, maxX: 200 }, items, placements, { padding: 0 })).toBe(
      placements,
    );
    const result = outlineNest({ ...bin, maxX: 200 }, items, { padding: 0 });
    expect(result).toMatchObject({ ok: true, usedOutline: false });
  });

  it('rejects outline corpora whose point-weighted work exceeds the interactive budget', () => {
    const triangle = item('triangle', [
      [0, 0],
      [1, 0],
      [0, 1],
    ]);
    const simple = Array.from({ length: 32 }, (_, index) => ({
      ...triangle,
      id: String(index),
    }));
    const detailed = simple.map((entry) => ({
      ...entry,
      outline: [
        points(Array.from({ length: 8 }, (_, pointIndex) => [pointIndex, pointIndex % 2] as const)),
      ],
    }));

    expect(isOutlineNestWithinWorkBudget(simple)).toBe(true);
    expect(isOutlineNestWithinWorkBudget(detailed)).toBe(false);
  });

  it('packs a deterministic thirty-two-part production corpus within its budget', () => {
    const items = Array.from({ length: 32 }, (_, index) =>
      item(
        String(index).padStart(2, '0'),
        [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
        10,
        10,
      ),
    );
    const started = performance.now();
    const result = outlineNest({ minX: 0, minY: 0, maxX: 100, maxY: 100 }, items, {
      padding: 0.5,
    });
    expect(result.ok).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

function item(
  id: string,
  vertices: ReadonlyArray<readonly [number, number]>,
  width = 40,
  height = 40,
): OutlineNestItem {
  return { id, width, height, canRotate: true, outline: [points(vertices)] };
}

function points(vertices: ReadonlyArray<readonly [number, number]>) {
  return vertices.map(([x, y]) => ({ x, y }));
}

function sideBySide(items: ReadonlyArray<OutlineNestItem>): NestPlacement[] {
  let x = 0;
  return items.map((entry) => {
    const placement = { id: entry.id, x, y: 0, rotated90: false };
    x += entry.width;
    return placement;
  });
}
