// "Skip inner shapes" for automatic tabs decides which closed shapes are holes.
// It must decide exactly as testing every pair of shapes did, while running the
// exact containment test only on pairs whose boxes allow it (ADR-494 Amendment 1).
import { describe, expect, it, vi } from 'vitest';
import type { Polyline, Vec2 } from '../scene';
import type * as Containment from './tab-contour-containment';
import { originalTabEligibility } from './tab-inner-shapes.test-support';
import { automaticTabEligibility } from './tab-layout';
import { applyAutomaticTabsToPolylines, type AutomaticTabsSettings } from './tabs-bridges';

const probe = vi.hoisted(() => ({ exactChecks: 0 }));

vi.mock('./tab-contour-containment', async (importOriginal) => {
  const actual = await importOriginal<typeof Containment>();
  return {
    ...actual,
    strictlyContains: (...args: Parameters<typeof actual.strictlyContains>) => {
      probe.exactChecks += 1;
      return actual.strictlyContains(...args);
    },
  };
});

const SKIP: AutomaticTabsSettings = {
  tabsEnabled: true,
  tabSizeMm: 1,
  tabsPerShape: 3,
  tabSkipInnerShapes: true,
};

const LAYOUTS: ReadonlyArray<{ readonly name: string; readonly shapes: () => Polyline[] }> = [
  { name: 'a sheet of parts with holes, islands and holes in islands', shapes: nestedSheet },
  { name: 'shapes whose boxes touch, match or share edges', shapes: touchingBoxes },
  { name: 'concave, crossing and self-crossing shapes', shapes: concaveAndCrossing },
  { name: 'open paths and contours too small to hold tabs', shapes: openAndDegenerate },
  { name: 'shapes far from the origin and tiny shapes', shapes: farAndTiny },
  { name: 'shapes too large for the box index', shapes: beyondIndexRange },
  { name: 'shapes with points that are not numbers', shapes: nonFinite },
  { name: 'a random layout with nesting and duplicates', shapes: () => randomLayout(20260929) },
  { name: 'another random layout', shapes: () => randomLayout(494) },
];

describe('skip inner shapes decides exactly as testing every pair did', () => {
  for (const layout of LAYOUTS) {
    it(`for ${layout.name}`, () => {
      const shapes = layout.shapes();
      for (const settings of [SKIP, { ...SKIP, tabSkipInnerShapes: false }]) {
        const expected = originalTabEligibility(shapes, settings);
        expect(automaticTabEligibility(shapes, settings)).toEqual(expected);
        // Each shape is split on its own, so the whole output follows from the decision.
        const alone = { ...settings, tabSkipInnerShapes: false };
        expect(applyAutomaticTabsToPolylines(shapes, settings)).toEqual(
          shapes.flatMap((shape, index) =>
            expected[index] === true ? applyAutomaticTabsToPolylines([shape], alone) : [shape],
          ),
        );
      }
    });
  }

  it('still finds every hole in the nested sheet', () => {
    // Guards the oracle comparison against a layout where nothing nests.
    const decided = automaticTabEligibility(nestedSheet(), SKIP);
    expect(decided.filter((eligible) => !eligible).length).toBeGreaterThan(20);
  });
});

// Every layout holds at least one real hole, so a count of 0 would mean the
// counter no longer sees the exact test, not that the pass is fast.
describe('skip inner shapes tests only pairs whose boxes allow it', () => {
  it('tests only the hole in a sheet of 3000 separate parts', () => {
    // Testing every pair ran the exact test 3001 x 3000 = 9,003,000 times.
    const parts = Array.from({ length: 3000 }, (_, index) =>
      circle((index % 60) * 10, Math.floor(index / 60) * 10, 4, 64),
    );
    const shapes = [...parts, circle(0, 0, 2, 16)];
    expect(countExactChecks(() => automaticTabEligibility(shapes, SKIP))).toEqual({
      checks: 1,
      result: shapes.map((_, index) => index < parts.length),
    });
  }, 60_000);

  it('tests each hole of 1500 parts against its own part only', () => {
    const shapes = Array.from({ length: 1500 }, (_, index) => {
      const x = (index % 50) * 12;
      const y = Math.floor(index / 50) * 12;
      return [rect(x, y, 10, 10), circle(x + 5, y + 5, 3, 32)];
    }).flat();
    const { checks, result } = countExactChecks(() => automaticTabEligibility(shapes, SKIP));
    expect(checks).toBe(1500);
    expect(result).toEqual(shapes.map((_, index) => index % 2 === 0));
  }, 60_000);

  it('tests only the hole among 3000 squares that share their edges', () => {
    const squares = Array.from({ length: 3000 }, (_, index) =>
      rect((index % 60) * 5, Math.floor(index / 60) * 5, 5, 5),
    );
    const shapes = [...squares, rect(1, 1, 3, 3)];
    expect(countExactChecks(() => automaticTabEligibility(shapes, SKIP))).toEqual({
      checks: 1,
      result: shapes.map((_, index) => index < squares.length),
    });
  }, 60_000);
});

function countExactChecks<T>(run: () => T): { readonly checks: number; readonly result: T } {
  probe.exactChecks = 0;
  const result = run();
  return { checks: probe.exactChecks, result };
}

function nestedSheet(): Polyline[] {
  const shapes: Polyline[] = [];
  for (let row = 0; row < 5; row += 1) {
    for (let column = 0; column < 5; column += 1) {
      const x = column * 40;
      const y = row * 40;
      const turn = (row + column) % 4;
      shapes.push(rect(x, y, 30, 30, { turn, reverse: row % 2 === 0, repeatStart: column > 2 }));
      shapes.push(rect(x + 5, y + 5, 20, 20, { turn: 3 - turn }));
      if ((row + column) % 2 === 0) shapes.push(circle(x + 15, y + 15, 6, 24));
      if ((row + column) % 3 === 0) shapes.push(rect(x + 13, y + 13, 4, 4, { reverse: true }));
      if (column === 4) shapes.push(circle(x + 27, y + 27, 1, 12));
    }
  }
  return shapes;
}

function touchingBoxes(): Polyline[] {
  return [
    ...Array.from({ length: 9 }, (_, index) =>
      rect((index % 3) * 10, Math.floor(index / 3) * 10, 10, 10),
    ),
    ...Array.from({ length: 6 }, (_, index) => circle(100 + index * 8, 0, 4, 16)),
    rect(200, 0, 20, 20),
    diamond(210, 10, 10),
    rect(200, 0, 10, 20),
    rect(250, 0, 20, 20),
    rect(255, 0, 10, 10),
    rect(260, 10, 10, 10, { turn: 2 }),
    rect(300, 0, 20, 20),
    rect(300, 0, 20, 20, { turn: 1 }),
    rect(300 + 1e-10, 1e-10, 20, 20),
    rect(300 + 1e-7, 0, 20, 20),
    rect(350, 0, 20, 20),
    rect(350 + 1e-12, 1e-12, 20 - 2e-12, 20 - 2e-12),
    rect(350 + 1e-6, 1e-6, 20 - 2e-6, 20 - 2e-6),
    rect(400, 0, 20, 20),
    rect(400 + 1e-6, 1e-6, 20 - 2e-6, 20 - 2e-6),
    rect(450, 0, 20, 20),
    rect(450 + 1e-8, 1e-8, 20 - 2e-8, 20 - 2e-8),
  ];
}

function concaveAndCrossing(): Polyline[] {
  const u = poly([0, 0], [30, 0], [30, 30], [20, 30], [20, 10], [10, 10], [10, 30], [0, 30]);
  return [
    u,
    rect(12, 15, 6, 10),
    rect(2, 2, 26, 6),
    translate(u, 50, 0),
    rect(51, 1, 8, 28),
    poly([100, 0], [140, 40], [140, 0], [100, 40]),
    rect(101, 18, 4, 4),
    rect(136, 18, 3, 4),
    rect(118, 18, 4, 4),
    rect(160, 0, 20, 20),
    rect(170, 10, 20, 20),
    rect(175, 15, 3, 3),
    star(230, 20, 20, 8, 7),
    circle(230, 20, 5, 20),
    circle(230, 20, 12, 20),
    poly(
      [260, 0],
      [300, 0],
      [300, 40],
      [260, 40],
      [260, 0],
      [270, 10],
      [290, 10],
      [290, 30],
      [270, 30],
      [270, 10],
    ),
    rect(275, 15, 10, 10),
  ];
}

function openAndDegenerate(): Polyline[] {
  return [
    { closed: false, points: rect(-10, -10, 60, 60).points },
    rect(0, 0, 40, 40),
    { closed: true, points: [p(5, 5), p(10, 5)] },
    { closed: true, points: [p(5, 5), p(10, 5), p(10, 5), p(5, 5)] },
    { closed: true, points: [p(5, 5), p(10, 5), p(15, 5)] },
    { closed: true, points: [] },
    { closed: true, points: [p(20, 20)] },
    { closed: false, points: [p(1, 1), p(39, 1), p(39, 39), p(1, 39)] },
    rect(10, 10, 10, 10),
    { closed: true, points: [p(-20, -20), p(80, -20), p(80, 80), p(-20, 80), p(-20, -20)] },
  ];
}

function farAndTiny(): Polyline[] {
  return [
    rect(1e9, 1e9, 100, 100),
    rect(1e9 + 10, 1e9 + 10, 10, 10),
    rect(1e9 + 100, 1e9, 50, 50),
    rect(0, 0, 1e-6, 1e-6),
    rect(2.5e-7, 2.5e-7, 5e-7, 5e-7),
    rect(1e-6, 0, 1e-6, 1e-6),
    rect(-5e5, -5e5, 1e6, 1e6),
  ];
}

// Every pair is tested here, as before.
function beyondIndexRange(): Polyline[] {
  return [
    rect(-1e200, -1e200, 2e200, 2e200),
    rect(-1e199, -1e199, 1e199, 1e199),
    rect(0, 0, 100, 100),
    rect(10, 10, 10, 10),
  ];
}

function nonFinite(): Polyline[] {
  return [
    rect(0, 0, 100, 100),
    rect(10, 10, 10, 10),
    { closed: true, points: [p(40, 40), p(60, 40), p(Number.NaN, 60), p(40, 60)] },
    {
      closed: true,
      points: [p(-Infinity, -10), p(Infinity, -10), p(Infinity, 200), p(-Infinity, 200)],
    },
    rect(70, 70, 10, 10),
  ];
}

function randomLayout(seed: number): Polyline[] {
  let state = seed;
  const next = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  return Array.from({ length: 400 }, () => {
    const x = Math.round(next() * 300);
    const y = Math.round(next() * 300);
    const size = 1 + Math.round(next() * 60) * (next() < 0.1 ? 3 : 1);
    const kind = next();
    const shape =
      kind < 0.4
        ? rect(x, y, size, size * (0.5 + next()), {
            turn: Math.floor(next() * 4),
            reverse: next() < 0.5,
          })
        : kind < 0.8
          ? circle(x, y, size / 2, 6 + Math.floor(next() * 20))
          : star(x, y, size / 2, 3 + Math.floor(next() * 5), size / 4);
    return next() < 0.05 ? { closed: false, points: shape.points } : shape;
  });
}

function p(x: number, y: number): Vec2 {
  return { x, y };
}

function poly(...corners: ReadonlyArray<readonly [number, number]>): Polyline {
  return { closed: true, points: corners.map(([x, y]) => p(x, y)) };
}

function translate(shape: Polyline, dx: number, dy: number): Polyline {
  return { ...shape, points: shape.points.map((point) => p(point.x + dx, point.y + dy)) };
}

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
  options: {
    readonly turn?: number;
    readonly reverse?: boolean;
    readonly repeatStart?: boolean;
  } = {},
): Polyline {
  const corners = [p(x, y), p(x + width, y), p(x + width, y + height), p(x, y + height)];
  const turn = options.turn ?? 0;
  const turned = [...corners.slice(turn), ...corners.slice(0, turn)];
  const ordered = options.reverse === true ? turned.reverse() : turned;
  const points = options.repeatStart === true ? [...ordered, ordered[0] as Vec2] : ordered;
  return { closed: true, points };
}

function diamond(cx: number, cy: number, radius: number): Polyline {
  return poly([cx, cy - radius], [cx + radius, cy], [cx, cy + radius], [cx - radius, cy]);
}

function circle(cx: number, cy: number, radius: number, count: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: count }, (_, index) => {
      const angle = (index / count) * Math.PI * 2;
      return p(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }),
  };
}

function star(cx: number, cy: number, outer: number, tips: number, inner: number): Polyline {
  return {
    closed: true,
    points: Array.from({ length: tips * 2 }, (_, index) => {
      const angle = (index / (tips * 2)) * Math.PI * 2;
      const radius = index % 2 === 0 ? outer : inner;
      return p(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    }),
  };
}
