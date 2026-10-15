import { describe, expect, it } from 'vitest';
import { planBoardArray } from './board-array-plan';
import { IDENTITY_TRANSFORM, type Bounds, type ShapeObject } from './scene-object';

const cell: Bounds = { minX: 20, minY: 30, maxX: 30, maxY: 40 };
const fill = { kind: 'fill', gapXMm: 0, gapYMm: 0 } as const;
function board(circle = false): ShapeObject {
  return {
    kind: 'shape',
    id: 'board',
    spec: circle
      ? { kind: 'ellipse', widthMm: 100, heightMm: 100 }
      : { kind: 'rect', widthMm: 100, heightMm: 100, cornerRadiusMm: 0 },
    bounds: { minX: 0, minY: 0, maxX: 100, maxY: 100 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
    color: '#000000',
  };
}

describe('board array plan', () => {
  it('accounts for margin and independent spacing in preview and requested count', () => {
    const plan = planBoardArray(cell, board(), {
      kind: 'grid',
      rows: 20,
      cols: 20,
      gapXMm: 10,
      gapYMm: 5,
      marginMm: 10,
    });
    expect(plan.requestedCount).toBe(400);
    expect(plan.offsets).toHaveLength(20); // four columns, five rows
    expect(plan.limited).toBe(false); // board size, not the responsiveness cap
    for (const slot of plan.offsets) {
      expect(cell.minX + slot.dx).toBeGreaterThanOrEqual(10);
      expect(cell.maxX + slot.dx).toBeLessThanOrEqual(90);
      expect(cell.minY + slot.dy).toBeGreaterThanOrEqual(10);
      expect(cell.maxY + slot.dy).toBeLessThanOrEqual(90);
    }
  });

  it('produces zero copies when artwork or margin leaves no fitting slot', () => {
    expect(planBoardArray({ ...cell, maxX: 150 }, board(), fill).offsets).toEqual([]);
    expect(planBoardArray(cell, board(), { ...fill, marginMm: 51 }).offsets).toEqual([]);
  });

  it('uses more of a circle while every footprint corner retains radial clearance', () => {
    const square = planBoardArray(cell, board(true), { ...fill, marginMm: 5 });
    const round = planBoardArray(cell, board(true), {
      ...fill,
      marginMm: 5,
      circlePacking: 'rows',
    });
    expect(round.offsets.length).toBeGreaterThan(square.offsets.length);
    for (const slot of round.offsets) {
      for (const x of [cell.minX + slot.dx, cell.maxX + slot.dx]) {
        for (const y of [cell.minY + slot.dy, cell.maxY + slot.dy]) {
          expect(Math.hypot(x - 50, y - 50)).toBeLessThanOrEqual(45 + 1e-9);
        }
      }
    }
  });

  it('tries fewer rows when a wide design fits only across the centre', () => {
    const wide = { minX: 0, minY: 0, maxX: 70, maxY: 40 };
    const plan = planBoardArray(wide, board(true), { ...fill, circlePacking: 'rows' });
    expect(plan.offsets).toEqual([{ dx: 15, dy: 30 }]);
  });

  it.each(['rows', 'square'] as const)(
    'keeps the true radius of a rotated circle in %s mode',
    (circlePacking) => {
      const rotated = { ...board(true), transform: { ...IDENTITY_TRANSFORM, rotationDeg: 45 } };
      const plan = planBoardArray(cell, rotated, { ...fill, circlePacking });
      expect(plan.boardBounds.maxX - plan.boardBounds.minX).toBeCloseTo(100);
      for (const slot of plan.offsets) {
        for (const x of [cell.minX + slot.dx, cell.maxX + slot.dx]) {
          for (const y of [cell.minY + slot.dy, cell.maxY + slot.dy]) {
            expect(Math.hypot(x, y - 50 * Math.SQRT2)).toBeLessThanOrEqual(50 + 1e-9);
          }
        }
      }
    },
  );

  it.each([false, true])('discloses bounded work for tiny artwork (circle=%s)', (circle) => {
    const plan = planBoardArray({ minX: 0, minY: 0, maxX: 0.01, maxY: 0.01 }, board(circle), {
      ...fill,
      circlePacking: 'rows',
    });
    expect(plan.limited).toBe(true);
    expect(plan.offsets.length).toBeLessThanOrEqual(500);
    expect(plan.offsets.length).toBeGreaterThan(0);
  });

  it('rejects non-finite footprints and normalises non-finite spacing', () => {
    expect(planBoardArray({ ...cell, maxX: Infinity }, board(), fill).offsets).toEqual([]);
    expect(planBoardArray(cell, board(), { ...fill, gapXMm: Infinity }).offsets).toEqual(
      planBoardArray(cell, board(), fill).offsets,
    );
  });
});
