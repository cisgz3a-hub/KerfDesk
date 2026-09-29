import { describe, expect, it } from 'vitest';
import type { ArrayPlacement } from '../scene/array-layout';
import type { Bounds, Vec2 } from '../scene/scene-object';
import {
  copyAlongPathCount,
  copyAlongPathLayout,
  tangentAtDistance,
  type CopyAlongPathGuidePath,
  type CopyAlongPathLayout,
  type CopyAlongPathSpec,
} from './copy-along-path';
import { pathWalk } from './path-walk';

// A 10 × 4 mm artwork centred on the origin, so each placement's dx/dy is the
// point on the guide where the copy's centre lands.
const SOURCE: Bounds = { minX: -5, minY: -2, maxX: 5, maxY: 2 };

const SPEC: CopyAlongPathSpec = {
  mode: 'count',
  count: 5,
  spacingMm: 10,
  startOffsetMm: 0,
  endOffsetMm: 0,
  rotateCopies: true,
};

function guide(points: ReadonlyArray<readonly [number, number]>, closed = false) {
  const walk = pathWalk({ closed, points: points.map(([x, y]) => ({ x, y })) });
  if (walk === null) throw new Error('guide has no length');
  return { walk, closed } satisfies CopyAlongPathGuidePath;
}

// 100 mm along +x.
const LINE = guide([
  [0, 0],
  [100, 0],
]);
// A 40 mm square, 160 mm round, running +x, +y, −x, −y from the origin.
const SQUARE = guide(
  [
    [0, 0],
    [40, 0],
    [40, 40],
    [0, 40],
    [0, 0],
  ],
  true,
);

function layout(
  path: CopyAlongPathGuidePath,
  patch: Partial<CopyAlongPathSpec>,
  source: Bounds = SOURCE,
): CopyAlongPathLayout {
  return copyAlongPathLayout(path, source, { ...SPEC, ...patch });
}

function placed(result: CopyAlongPathLayout): ReadonlyArray<ArrayPlacement> {
  if (result.kind !== 'placed') throw new Error(`expected copies, got ${result.kind}`);
  return result.placements;
}

function points(result: CopyAlongPathLayout): ReadonlyArray<Vec2> {
  return placed(result).map((placement) => ({
    x: round(placement.dx),
    y: round(placement.dy),
  }));
}

function angles(result: CopyAlongPathLayout): ReadonlyArray<number> {
  return placed(result).map((placement) => round(placement.rotationDeg));
}

function xs(result: CopyAlongPathLayout): ReadonlyArray<number> {
  return points(result).map((point) => point.x);
}

function round(value: number): number {
  const rounded = Math.round(value * 1e6) / 1e6;
  return Object.is(rounded, -0) ? 0 : rounded;
}

describe('copy along an open guide', () => {
  it('puts the first copy at the start and the last at the end', () => {
    const result = layout(LINE, { count: 5 });
    expect(xs(result)).toEqual([0, 25, 50, 75, 100]);
    expect(result).toMatchObject({ stepMm: 25 });
  });

  it('runs from the start offset to the end offset', () => {
    expect(xs(layout(LINE, { count: 3, startOffsetMm: 10, endOffsetMm: 20 }))).toEqual([
      10, 45, 80,
    ]);
  });

  it('puts a single copy at the start offset', () => {
    expect(xs(layout(LINE, { count: 1, startOffsetMm: 30 }))).toEqual([30]);
  });

  it('explains offsets that leave no room, and copies that would pile on one point', () => {
    expect(layout(LINE, { startOffsetMm: 60, endOffsetMm: 50 })).toEqual({ kind: 'no-room' });
    expect(layout(LINE, { count: 3, startOffsetMm: 50, endOffsetMm: 50 })).toEqual({
      kind: 'no-room',
    });
    expect(xs(layout(LINE, { count: 1, startOffsetMm: 50, endOffsetMm: 50 }))).toEqual([50]);
  });

  it('centres the artwork box, wherever it is, on the guide', () => {
    const source = { minX: 10, minY: 30, maxX: 20, maxY: 40 };
    expect(points(layout(LINE, { count: 2 }, source))).toEqual([
      { x: -15, y: -35 },
      { x: 85, y: -35 },
    ]);
  });
});

describe('copy along a closed guide', () => {
  it('spreads the copies all the way round without doubling the start', () => {
    const result = layout(SQUARE, { count: 8 });
    expect(points(result)).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 40, y: 40 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
      { x: 0, y: 20 },
    ]);
    expect(result).toMatchObject({ stepMm: 20 });
  });

  it('moves the whole ring round by the start offset, wrapping past the seam', () => {
    expect(points(layout(SQUARE, { count: 2, startOffsetMm: 170 }))).toEqual([
      { x: 10, y: 0 },
      { x: 30, y: 40 },
    ]);
  });

  it('ignores the end offset', () => {
    expect(points(layout(SQUARE, { count: 4, endOffsetMm: 30 }))).toEqual(
      points(layout(SQUARE, { count: 4 })),
    );
  });
});

describe('rotation', () => {
  it('turns each copy by the direction of the guide where it sits', () => {
    const result = layout(SQUARE, { count: 8, startOffsetMm: 10 });
    expect(angles(result)).toEqual([0, 0, 90, 90, 180, 180, 270, 270]);
    expect(placed(result)[2]?.pivot).toEqual({ x: 40, y: 10 });
  });

  it('uses the edge leaving a corner, and the last edge at the very end', () => {
    const bend = guide([
      [0, 0],
      [10, 0],
      [10, 10],
    ]);
    expect(angles(layout(bend, { count: 3 }))).toEqual([0, 90, 90]);
  });

  it('follows a diagonal', () => {
    const diagonal = guide([
      [0, 0],
      [-10, -10],
    ]);
    expect(angles(layout(diagonal, { count: 1 }))).toEqual([225]);
  });

  it('leaves copies upright when rotation is off', () => {
    const result = placed(layout(SQUARE, { count: 4, startOffsetMm: 10, rotateCopies: false }));
    expect(result.every((placement) => placement.rotationDeg === 0)).toBe(true);
    expect(result.every((placement) => placement.pivot === undefined)).toBe(true);
  });

  it('skips repeated points when finding the direction', () => {
    const stutter = guide([
      [0, 0],
      [0, 0],
      [0, 10],
      [0, 10],
    ]);
    expect(tangentAtDistance(stutter.walk, 0)).toEqual({ x: 0, y: 1 });
    expect(tangentAtDistance(stutter.walk, 10)).toEqual({ x: 0, y: 1 });
  });
});

describe('spacing between centres', () => {
  it('steps from the start offset until the end offset', () => {
    expect(xs(layout(LINE, { mode: 'spacing', spacingMm: 30 }))).toEqual([0, 30, 60, 90]);
    expect(xs(layout(LINE, { mode: 'spacing', spacingMm: 25 }))).toEqual([0, 25, 50, 75, 100]);
    expect(xs(layout(LINE, { mode: 'spacing', spacingMm: 30, startOffsetMm: 5 }))).toEqual([
      5, 35, 65, 95,
    ]);
    expect(xs(layout(LINE, { mode: 'spacing', spacingMm: 30, endOffsetMm: 15 }))).toEqual([
      0, 30, 60,
    ]);
  });

  it('keeps at least the spacing across the seam of a closed guide', () => {
    const count = (spacingMm: number): number =>
      placed(layout(SQUARE, { mode: 'spacing', spacingMm })).length;
    expect(count(40)).toBe(4);
    expect(count(50)).toBe(3);
    expect(count(60)).toBe(2);
    expect(count(200)).toBe(1);
  });

  it('explains a spacing that would pile every copy on one point', () => {
    expect(layout(LINE, { mode: 'spacing', spacingMm: 0 })).toEqual({ kind: 'no-step' });
    expect(layout(LINE, { mode: 'spacing', spacingMm: -5 })).toEqual({ kind: 'no-step' });
    expect(layout(LINE, { mode: 'spacing', spacingMm: Number.NaN })).toEqual({
      kind: 'no-step',
    });
  });
});

describe('gap between copies', () => {
  it('keeps the gap between the edges of turning copies', () => {
    // 10 mm wide copies 5 mm apart: centres every 15 mm.
    const result = layout(LINE, { mode: 'gap', spacingMm: 5 });
    expect(xs(result)).toEqual([0, 15, 30, 45, 60, 75, 90]);
    expect(result).toMatchObject({ stepMm: 15 });
  });

  it('measures upright copies across the way the guide runs', () => {
    const vertical = guide([
      [0, 0],
      [0, 50],
    ]);
    // 4 mm tall copies going up, 6 mm apart: centres every 10 mm.
    const result = layout(vertical, { mode: 'gap', spacingMm: 6, rotateCopies: false });
    expect(points(result).map((point) => point.y)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(result).toMatchObject({ stepMm: null });
  });

  it('lets copies touch at a zero gap, and keeps the gap across a closed seam', () => {
    expect(xs(layout(LINE, { mode: 'gap', spacingMm: 0 }))).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100,
    ]);
    // 160 mm round, copies every 15 mm: the 11th would sit 10 mm from the first.
    expect(placed(layout(SQUARE, { mode: 'gap', spacingMm: 5 }))).toHaveLength(10);
  });

  it('explains artwork with no size along the guide and no gap', () => {
    const sliver = { minX: 0, minY: 0, maxX: 0, maxY: 8 };
    expect(layout(LINE, { mode: 'gap', spacingMm: 0 }, sliver)).toEqual({ kind: 'no-step' });
  });
});

describe('a bound on the copies', () => {
  const BOUND = 1_000;

  it('refuses a count past the bound before laying anything out', () => {
    for (const count of [BOUND + 1, 1e12, 1e300]) {
      const spec = { ...SPEC, count };
      expect(copyAlongPathLayout(LINE, SOURCE, spec, BOUND)).toEqual({ kind: 'too-many' });
      expect(copyAlongPathLayout(SQUARE, SOURCE, spec, BOUND)).toEqual({ kind: 'too-many' });
    }
  });

  it('takes exactly as many copies as the bound allows, and none when there is no room', () => {
    for (const path of [LINE, SQUARE]) {
      const atBound = copyAlongPathLayout(path, SOURCE, { ...SPEC, count: BOUND }, BOUND);
      expect(placed(atBound)).toHaveLength(BOUND);
    }
    const spacing = { ...SPEC, mode: 'spacing', spacingMm: 25 } as const;
    expect(copyAlongPathLayout(LINE, SOURCE, { ...SPEC, count: 1 }, 0)).toEqual({
      kind: 'too-many',
    });
    expect(copyAlongPathLayout(LINE, SOURCE, spacing, 0)).toEqual({ kind: 'too-many' });
    // 100 mm at 25 mm: five copies, so a bound of five holds them and four does not.
    expect(placed(copyAlongPathLayout(LINE, SOURCE, spacing, 5))).toHaveLength(5);
    expect(copyAlongPathLayout(LINE, SOURCE, spacing, 4)).toEqual({ kind: 'too-many' });
  });

  it('stops stepping at the bound however long the guide is', () => {
    // Half a metre of guide at 0.002 mm is 250,000 copies, and the ring 400,000.
    const long = guide([
      [0, 0],
      [500, 0],
    ]);
    const ring = guide(
      [
        [0, 0],
        [200, 0],
        [200, 200],
        [0, 200],
        [0, 0],
      ],
      true,
    );
    const tiny = { ...SPEC, mode: 'spacing', spacingMm: 0.002 } as const;
    // Upright specks a hair apart: each one's reach depends on where it lands.
    const speck = { minX: 0, minY: 0, maxX: 0.001, maxY: 0.001 };
    const gap = { ...tiny, mode: 'gap', rotateCopies: false } as const;
    for (const path of [long, ring]) {
      expect(copyAlongPathLayout(path, SOURCE, tiny, 500)).toEqual({ kind: 'too-many' });
      expect(copyAlongPathLayout(path, speck, gap, 500)).toEqual({ kind: 'too-many' });
    }
  });

  it('counts the copies without laying them out, to the same answer as the layout', () => {
    const specs: ReadonlyArray<Partial<CopyAlongPathSpec>> = [
      { count: 1 },
      { count: 7, startOffsetMm: 10, endOffsetMm: 20 },
      { mode: 'spacing', spacingMm: 30 },
      { mode: 'gap', spacingMm: 5 },
      { mode: 'gap', spacingMm: 6, rotateCopies: false },
      { mode: 'spacing', spacingMm: 0 },
      { startOffsetMm: 60, endOffsetMm: 50 },
    ];
    for (const path of [LINE, SQUARE]) {
      for (const patch of specs) {
        const spec = { ...SPEC, ...patch };
        const laid = copyAlongPathLayout(path, SOURCE, spec);
        const counted = copyAlongPathCount(path, SOURCE, spec);
        expect(counted).toEqual(
          laid.kind === 'placed'
            ? { kind: 'counted', count: laid.placements.length, stepMm: laid.stepMm }
            : laid,
        );
      }
    }
  });

  it('counts however many copies are asked for as quickly as it counts one', () => {
    const counted = copyAlongPathCount(LINE, SOURCE, { ...SPEC, count: 5_000_000_000 });
    expect(counted).toMatchObject({ kind: 'counted', count: 5_000_000_000 });
    expect(counted.kind === 'counted' ? counted.stepMm : null).toBeCloseTo(100 / 4_999_999_999, 15);
  });
});
