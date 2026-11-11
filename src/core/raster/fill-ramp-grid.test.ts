import { describe, expect, it } from 'vitest';
import type { Polyline } from '../scene';
import { fillRampGrid, type FillRampGridInput } from './fill-ramp-grid';

function square(minX: number, minY: number, size: number): Polyline {
  return {
    closed: true,
    points: [
      { x: minX, y: minY },
      { x: minX + size, y: minY },
      { x: minX + size, y: minY + size },
      { x: minX, y: minY + size },
    ],
  };
}

// A 20 mm stamp plate with a 6 mm letter-sized hole in the middle.
const PLATE = [square(0, 0, 20), square(7, 7, 6)];

function input(overrides: Partial<FillRampGridInput> = {}): FillRampGridInput {
  return {
    contours: PLATE,
    pitchXmm: 1,
    pitchYmm: 1,
    rampLengthMm: 3,
    rampOuterEdge: false,
    sMax: 1000,
    sMin: 100,
    maxCells: 1_000_000,
    ...overrides,
  };
}

/** S at the cell whose centre is (x, y) mm. */
function sAt(result: ReturnType<typeof fillRampGrid>, x: number, y: number): number {
  if (result.kind !== 'ok') throw new Error(result.kind);
  const { grid } = result;
  const col = Math.floor(x - grid.bounds.minX);
  const row = Math.floor(y - grid.bounds.minY);
  return grid.sValues[row * grid.width + col] ?? Number.NaN;
}

describe('fillRampGrid (ADR-699)', () => {
  it('ramps from min power at a hole edge to full power at the ramp length', () => {
    const result = fillRampGrid(input());
    // Beside the hole (x = 6.5 is 0.5 mm from its edge at 7): near Min power.
    expect(sAt(result, 6.5, 10.5)).toBe(Math.round(100 + (0.5 / 3) * 900));
    expect(sAt(result, 5.5, 10.5)).toBe(Math.round(100 + (1.5 / 3) * 900));
    // 3 mm or more from the hole: full power.
    expect(sAt(result, 3.5, 10.5)).toBe(1000);
    // Inside the hole nothing burns.
    expect(sAt(result, 10.5, 10.5)).toBe(0);
  });

  it('cuts the outer edge square unless Ramp outer edge is on', () => {
    expect(sAt(fillRampGrid(input()), 0.5, 0.5)).toBe(1000);
    const outer = fillRampGrid(input({ rampOuterEdge: true }));
    expect(sAt(outer, 0.5, 10.5)).toBe(Math.round(100 + (0.5 / 3) * 900));
    // A corner is nearer the edge than either side alone says, never further.
    expect(sAt(outer, 0.5, 0.5)).toBe(Math.round(100 + (0.5 / 3) * 900));
  });

  it('burns a shape without holes flat when its outer edge is square', () => {
    const result = fillRampGrid(input({ contours: [square(0, 0, 10)] }));
    if (result.kind !== 'ok') throw new Error(result.kind);
    const burned = Array.from(result.grid.sValues).filter((value) => value > 0);
    expect(burned).toHaveLength(100);
    expect(new Set(burned)).toEqual(new Set([1000]));
  });

  it('refuses a grid above its cell limit and ignores open or empty artwork', () => {
    expect(fillRampGrid(input({ maxCells: 100 }))).toEqual({ kind: 'too-large', cells: 484 });
    expect(fillRampGrid(input({ contours: [{ ...square(0, 0, 10), closed: false }] }))).toEqual({
      kind: 'empty',
    });
  });

  it('places the grid on the artwork, with every filled cell kept (ADR-699 Amd 1)', () => {
    const result = fillRampGrid(input());
    if (result.kind !== 'ok') throw new Error(result.kind);
    expect(result.grid.bounds).toEqual({ minX: 0, minY: 0, maxX: 20, maxY: 20 });
    expect(result.grid.filledCells).toBe(400 - 36);
    expect(Array.from(result.grid.sValues).filter((value) => value > 0)).toHaveLength(400 - 36);
  });
});
