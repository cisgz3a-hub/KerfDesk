import { describe, expect, it } from 'vitest';
import { layoutNest, searchNestLayouts, type NestingInput } from './layout-nest';
import { validateNest } from './outline-compact-nest';
import { nestRotation, type NestPlacement, type NestRect } from './quick-nest';

const INPUT: NestingInput = {
  bin: { minX: 0, minY: 0, maxX: 100, maxY: 70 },
  padding: 2,
  goal: 'compact',
  method: 'outline',
  optimise: true,
  obstacles: [{ minX: 0, minY: 0, maxX: 21, maxY: 25 }],
  items: Array.from({ length: 7 }, (_, index) => ({
    id: `part:${index}`,
    width: 11 + index * 2,
    height: 9 + index,
    canRotate: true,
    rotationAngles: [0, 90, 180, 270] as const,
  })),
};

describe('manufacturing layout goals', () => {
  it.each(['tidy', 'compact', 'grid'] as const)(
    'keeps every %s layout inside stock with independently checked clearances',
    (goal) => {
      const result = layoutNest({ ...INPUT, goal });
      expect(result).not.toBeNull();
      if (result === null) return;
      assertRectangularFit({ ...INPUT, goal }, result.placements);
      expect(result.stockUtilisationPercent).toBeCloseTo(
        (INPUT.items.reduce((sum, item) => sum + item.width * item.height, 0) / 7000) * 100,
      );
    },
  );

  it('places grid cells at a uniform pitch even around an obstacle', () => {
    const result = layoutNest({ ...INPUT, goal: 'grid' });
    expect(result).not.toBeNull();
    if (result === null) return;
    const xs = result.placements.map((p) => p.x);
    const ys = result.placements.map((p) => p.y);
    expect(xs.every((x) => Math.abs((x - 1) / 25 - Math.round((x - 1) / 25)) < 1e-9)).toBe(true);
    expect(ys.every((y) => Math.abs((y - 1) / 17 - Math.round((y - 1) / 17)) < 1e-9)).toBe(true);
  });

  it('uses an explicitly required half-turn and validates its physical dimensions', () => {
    const input = {
      ...INPUT,
      items: [
        {
          id: 'directional',
          width: 60,
          height: 20,
          canRotate: true,
          rotationAngles: [180] as const,
        },
      ],
      obstacles: [],
      optimise: false,
    };
    const result = layoutNest(input);
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(nestRotation(result.placements[0]!)).toBe(180);
    assertRectangularFit(input, result.placements);
    expect(
      validateNest(
        input.bin,
        input.items,
        [{ ...result.placements[0]!, rotationDeg: 270, rotated90: true }],
        input,
      ),
    ).toBe(false);
  });

  it('cannot quarter-turn grain-restricted parts just to fit a narrower bin', () => {
    expect(
      layoutNest({
        ...INPUT,
        bin: { minX: 0, minY: 0, maxX: 25, maxY: 65 },
        obstacles: [],
        items: [{ id: 'grain', width: 60, height: 20, canRotate: true, rotationAngles: [0, 180] }],
      }),
    ).toBeNull();
  });

  it('retains a monotonically improving complete best result in every search update', () => {
    const updates = [...searchNestLayouts(INPUT)];
    expect(updates).toHaveLength(24);
    let previous = Infinity;
    for (const update of updates) {
      expect(update.best).not.toBeNull();
      if (update.best === null) continue;
      expect(update.best.footprintAreaMm2).toBeLessThanOrEqual(previous);
      previous = update.best.footprintAreaMm2;
      assertRectangularFit(INPUT, update.best.placements);
    }
  });

  it('interlocks triangles without a positive-area intersection by an independent separating-axis oracle', () => {
    const upper = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ];
    const lower = [
      { x: 40, y: 40 },
      { x: 40, y: 0 },
      { x: 0, y: 40 },
    ];
    const input = {
      ...INPUT,
      padding: 0,
      bin: { minX: 0, minY: 0, maxX: 40, maxY: 40 },
      obstacles: [],
      items: [upper, lower].map((points, index) => ({
        id: String(index),
        width: 40,
        height: 40,
        canRotate: false,
        outline: [points],
      })),
    };
    const result = layoutNest(input);
    expect(result?.usedOutline).toBe(true);
    if (result === null) return;
    const polygons = result.placements.map((p) =>
      input.items
        .find((item) => item.id === p.id)!
        .outline[0]!.map((point) => ({ x: point.x + p.x, y: point.y + p.y })),
    );
    expect(hasSeparatingAxis(polygons[0]!, polygons[1]!)).toBe(true);
  });

  it('rejects incomplete, duplicate and non-finite drafts', () => {
    const result = layoutNest(INPUT)!;
    expect(validateNest(INPUT.bin, INPUT.items, result.placements.slice(1), INPUT)).toBe(false);
    expect(
      validateNest(
        INPUT.bin,
        INPUT.items,
        result.placements.map(() => result.placements[0]!),
        INPUT,
      ),
    ).toBe(false);
    expect(
      validateNest(
        INPUT.bin,
        INPUT.items,
        result.placements.map((p) => ({ ...p, x: NaN })),
        INPUT,
      ),
    ).toBe(false);
  });
});

function assertRectangularFit(input: NestingInput, placements: ReadonlyArray<NestPlacement>): void {
  expect(new Set(placements.map((p) => p.id))).toEqual(new Set(input.items.map((item) => item.id)));
  const rects = placements.map((placement) => {
    const item = input.items.find((entry) => entry.id === placement.id)!;
    expect(item.rotationAngles?.includes(nestRotation(placement))).toBe(true);
    const quarter = nestRotation(placement) === 90 || nestRotation(placement) === 270;
    return {
      minX: placement.x,
      minY: placement.y,
      maxX: placement.x + (quarter ? item.height : item.width),
      maxY: placement.y + (quarter ? item.width : item.height),
    };
  });
  const half = input.padding / 2;
  for (const [index, rect] of rects.entries()) {
    expect(rect.minX).toBeGreaterThanOrEqual(input.bin.minX + half - 1e-6);
    expect(rect.minY).toBeGreaterThanOrEqual(input.bin.minY + half - 1e-6);
    expect(rect.maxX).toBeLessThanOrEqual(input.bin.maxX - half + 1e-6);
    expect(rect.maxY).toBeLessThanOrEqual(input.bin.maxY - half + 1e-6);
    for (const other of [...rects.slice(index + 1), ...(input.obstacles ?? [])]) {
      expect(separated(rect, other, input.padding)).toBe(true);
    }
  }
}

function separated(a: NestRect, b: NestRect, gap: number): boolean {
  return (
    a.maxX + gap <= b.minX + 1e-6 ||
    b.maxX + gap <= a.minX + 1e-6 ||
    a.maxY + gap <= b.minY + 1e-6 ||
    b.maxY + gap <= a.minY + 1e-6
  );
}

function hasSeparatingAxis(
  a: ReadonlyArray<{ x: number; y: number }>,
  b: ReadonlyArray<{ x: number; y: number }>,
): boolean {
  for (const polygon of [a, b])
    for (const [index, point] of polygon.entries()) {
      const next = polygon[(index + 1) % polygon.length]!;
      const axis = { x: point.y - next.y, y: next.x - point.x };
      const projected = [a, b].map((points) => points.map((p) => p.x * axis.x + p.y * axis.y));
      if (
        Math.max(...projected[0]!) <= Math.min(...projected[1]!) + 1e-7 ||
        Math.max(...projected[1]!) <= Math.min(...projected[0]!) + 1e-7
      )
        return true;
    }
  return false;
}
