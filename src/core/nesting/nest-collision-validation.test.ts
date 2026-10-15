import fc from 'fast-check';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as geometry from './nest-outline-geometry';
import { bruteForceValidateNest } from './nest-validation-brute-force.test-support';
import { validateNest, type NestOutline, type OutlineNestItem } from './outline-compact-nest';
import {
  nestTurn,
  type NestOptions,
  type NestPlacement,
  type NestRect,
  type NestRotation,
} from './quick-nest';

afterEach(() => vi.restoreAllMocks());
const bin: NestRect = { minX: -100, minY: -100, maxX: 300, maxY: 300 };
const turns: NestRotation[] = [0, 90, 180, 270];
const square: NestOutline = [
  [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ],
];
const triangle: NestOutline = [
  [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 0, y: 4 },
  ],
];
const ring: NestOutline = [
  square[0]!,
  [
    { x: 1, y: 1 },
    { x: 1, y: 3 },
    { x: 3, y: 3 },
    { x: 3, y: 1 },
  ],
];

function item(id: string, outline?: NestOutline): OutlineNestItem {
  return {
    id,
    width: 4,
    height: 4,
    canRotate: true,
    rotationAngles: turns,
    ...(outline ? { outline } : {}),
  };
}
function placement(id: string, x: number, y: number, angle: NestRotation = 0): NestPlacement {
  return { id, x, y, ...nestTurn(angle) };
}
function matchesOracle(
  items: OutlineNestItem[],
  placements: NestPlacement[],
  options: NestOptions,
  bounds = bin,
) {
  const expected = bruteForceValidateNest(bounds, items, placements, options);
  expect(validateNest(bounds, items, placements, options)).toBe(expected);
  return expected;
}

describe('indexed nest collision validation', () => {
  it('matches all-pairs validation across seeded rectangles, outlines, rotations and obstacles', () => {
    const entry = fc.record({
      x: fc.integer({ min: -10, max: 60 }),
      y: fc.integer({ min: -10, max: 60 }),
      shape: fc.integer({ min: 0, max: 3 }),
      turn: fc.constantFrom(...turns),
    });
    fc.assert(
      fc.property(
        fc.array(entry, { minLength: 0, maxLength: 35 }),
        fc.array(entry, { maxLength: 8 }),
        fc.constantFrom(0, 1e-8, 1e-7, 0.5, 2, 10),
        (entries, blocks, padding) => {
          const shapes = [undefined, square, triangle, ring];
          const items = entries.map((entry, index) => item(String(index), shapes[entry.shape]));
          const placements = entries.map((entry, index) =>
            placement(String(index), entry.x, entry.y, entry.turn),
          );
          const obstacles = blocks.map((entry) => ({
            minX: entry.x,
            minY: entry.y,
            maxX: entry.x + 3,
            maxY: entry.y + 3,
          }));
          matchesOracle(items, placements, { padding, obstacles });
        },
      ),
      { seed: 20261014, numRuns: 300 },
    );
  });

  it('keeps touching, sub-tolerance overlap and exact padding decisions in both input orders', () => {
    for (const outline of [undefined, square, triangle, ring]) {
      for (const angle of turns) {
        for (const padding of [0, 0.5, 2]) {
          for (const delta of [-2e-7, -1e-7, -1e-8, 0, 1e-8, 1e-7, 2e-7]) {
            const items = [item('a', outline), item('b', outline)];
            const placements = [
              placement('a', 0, 0, angle),
              placement('b', 4 + padding + delta, 0, angle),
            ];
            matchesOracle(items, placements, { padding });
            matchesOracle([...items].reverse(), [...placements].reverse(), { padding });
            const obstacle = {
              minX: 4 + padding + delta,
              minY: 0,
              maxX: 8 + padding + delta,
              maxY: 4,
            };
            matchesOracle(items.slice(0, 1), placements.slice(0, 1), {
              padding,
              obstacles: [obstacle],
            });
          }
        }
      }
    }
  });

  it('retains holes and complementary outlines with overlapping bounding boxes', () => {
    const insert = {
      ...item('insert', square),
      width: 1,
      height: 1,
      outline: [square[0]!.map((p) => ({ x: p.x / 4, y: p.y / 4 }))],
    };
    expect(
      matchesOracle(
        [item('ring', ring), insert],
        [placement('ring', 0, 0), placement('insert', 1.5, 1.5)],
        { padding: 0 },
      ),
    ).toBe(true);
    const complement = triangle.map((path) => path.map((p) => ({ x: 4 - p.x, y: 4 - p.y })));
    expect(
      matchesOracle(
        [item('a', triangle), item('b', complement)],
        [placement('a', 0, 0), placement('b', 0, 0)],
        { padding: 0 },
      ),
    ).toBe(true);
  });

  it('uses transformed artwork bounds instead of declared width and ignores obstacle/obstacle overlap', () => {
    const shifted = square.map((path) => path.map((p) => ({ x: p.x + 30, y: p.y })));
    expect(
      matchesOracle(
        [item('a', shifted), item('b')],
        [placement('a', 0, 0), placement('b', 31, 0)],
        { padding: 0 },
      ),
    ).toBe(false);
    const obstacles = [
      { minX: 80, minY: 80, maxX: 90, maxY: 90 },
      { minX: 85, minY: 85, maxX: 95, maxY: 95 },
    ];
    expect(
      matchesOracle([item('a', square)], [placement('a', 0, 0)], { padding: 1, obstacles }),
    ).toBe(true);
  });

  it('retains invalid input and extreme-coordinate outcomes', () => {
    for (const coordinate of [NaN, Infinity, -Infinity, 1e200, -1e200]) {
      matchesOracle([item('a')], [placement('a', coordinate, 0)], { padding: 0 });
      matchesOracle([item('a', square)], [placement('a', 0, 0)], { padding: coordinate });
    }
    const maximum = Number.MAX_VALUE;
    for (const outline of [undefined, square]) {
      matchesOracle(
        [item('a', outline)],
        [placement('a', 0, 0)],
        {
          padding: maximum,
          obstacles: [{ minX: maximum, minY: 0, maxX: maximum, maxY: 4 }],
        },
        { minX: -maximum, minY: -maximum, maxX: maximum, maxY: maximum },
      );
      matchesOracle(
        [item('a', outline), item('a', outline)],
        [placement('a', 0, 0), placement('a', 10, 0)],
        { padding: 0 },
      );
      matchesOracle([item('a', outline)], [{ ...placement('a', 0, 0), rotated90: true }], {
        padding: 0,
      });
      matchesOracle([item('a', outline)], [], { padding: 0 });
    }
  });

  it('avoids all-pairs exact checks for 10000 separate rectangles without a timing threshold', () => {
    const items = Array.from({ length: 10_000 }, (_, i) => item(String(i)));
    const placements = items.map((item, i) =>
      placement(item.id, (i % 100) * 6, Math.floor(i / 100) * 6),
    );
    const overlap = vi.spyOn(geometry, 'rectanglesOverlap');
    expect(
      validateNest({ minX: -1, minY: -1, maxX: 600, maxY: 600 }, items, placements, { padding: 1 }),
    ).toBe(true);
    expect(overlap.mock.calls.length).toBeLessThan(items.length);
  });
});
