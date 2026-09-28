import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import {
  burnDoseRange,
  burnLayout,
  burnsAnything,
  createBurner,
  type BurnLaser,
  type BurnLayout,
  type BurnMoves,
} from './burn-grid';

type Move = readonly [
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  power: number,
  feedMmPerMin?: number,
];

// Moves at Z0: a power above 0 burns, 0 is a traversal. 3000 mm/min unless given.
function moves(list: ReadonlyArray<Move>, z = 0): BurnMoves {
  const positions = new Float32Array(list.length * 6);
  const segKind = new Uint8Array(list.length);
  const segPower = new Float32Array(list.length);
  const segFeed = new Float32Array(list.length);
  list.forEach(([x0, y0, x1, y1, power, feed = 3000], index) => {
    positions.set([x0, y0, z, x1, y1, z], index * 6);
    segKind[index] = power > 0 ? SEG_KIND.cut : SEG_KIND.travel;
    segPower[index] = power;
    segFeed[index] = feed;
  });
  return { segmentCount: list.length, positions, segKind, segPower, segFeed };
}

const LASER: BurnLaser = { maxPowerS: 1000, spotMm: 0.1 };

// 10 x 10 cells of 0.1 mm from (0, 0).
const GRID: BurnLayout = { originX: 0, originY: 0, mmPerCell: 0.1, columns: 10, rows: 10, z: 0 };

function burned(list: ReadonlyArray<Move>, layout = GRID, laser = LASER) {
  const program = moves(list);
  const burner = createBurner(layout, program, laser);
  burner.burnTo({ index: program.segmentCount, fraction: 0 });
  return (column: number, row: number): number =>
    burner.darkness[row * layout.columns + column] ?? -1;
}

describe('the burn a laser program leaves (ADR-487)', () => {
  it('burns a beam one cell wide along a line, darker the more power', () => {
    const full = burned([[0, 0.55, 1, 0.55, 1000]]);
    // Full power leaves 8% of the light.
    expect(full(4, 5)).toBe(Math.round(255 * 0.92));
    expect(full(4, 4)).toBe(0);
    expect(full(4, 6)).toBe(0);
    const half = burned([[0, 0.55, 1, 0.55, 500]]);
    expect(half(4, 5)).toBe(Math.round(255 * 0.46));
  });

  it('darkens a place further with every pass over it', () => {
    const twice = burned([
      [0, 0.55, 1, 0.55, 500],
      [1, 0.55, 0, 0.55, 500],
    ]);
    expect(twice(4, 5)).toBe(Math.round(255 * (1 - 0.54 * 0.54)));
  });

  it('burns nothing along a traversal or with the laser at S0', () => {
    const program = moves([
      [0, 0.55, 1, 0.55, 0],
      [0, 0.35, 1, 0.35, 0],
    ]);
    expect(burnsAnything(program)).toBe(false);
    expect(burnLayout(program, LASER)).toBeNull();
  });

  it('keeps the tone of a fill whose lines are finer than the cells', () => {
    // 0.1 mm lines 0.1 mm apart over 0.4 mm cells: each cell fully burned once.
    const coarse: BurnLayout = { ...GRID, mmPerCell: 0.4, columns: 5, rows: 5 };
    const lines: Move[] = [];
    for (let y = 0.05; y < 2; y += 0.1) lines.push([0, y, 2, y, 1000]);
    const fill = burned(lines, coarse);
    expect(fill(2, 2)).toBeGreaterThan(Math.round(255 * 0.92) - 3);
    expect(fill(2, 2)).toBeLessThan(Math.round(255 * 0.92) + 3);
  });

  it('spreads a beam wider than a cell across the cells it covers', () => {
    const wide = burned([[0, 0.5, 1, 0.5, 1000]], GRID, { ...LASER, spotMm: 0.3 });
    // Rows 3.5 to 6.5 cells up are under the beam.
    expect(wide(5, 4)).toBeGreaterThan(200);
    expect(wide(5, 5)).toBeGreaterThan(200);
    expect(wide(5, 2)).toBe(0);
  });

  it('burns the same whether playback gets there in one step or several', () => {
    const program = moves([
      [0, 0.25, 1, 0.25, 700],
      [1, 0.75, 0, 0.75, 1000],
    ]);
    const whole = createBurner(GRID, program, LASER);
    whole.burnTo({ index: 2, fraction: 0 });
    const stepped = createBurner(GRID, program, LASER);
    for (const target of [
      { index: 0, fraction: 0.3 },
      { index: 0, fraction: 0.8 },
      { index: 1, fraction: 0.5 },
      { index: 2, fraction: 0 },
    ]) {
      stepped.burnTo(target);
    }
    expect([...stepped.darkness]).toEqual([...whole.darkness]);
  });

  it('starts again going back, and reports only the rows a step reached', () => {
    const program = moves([
      [0, 0.15, 1, 0.15, 1000],
      [0, 0.85, 1, 0.85, 1000],
    ]);
    const burner = createBurner(GRID, program, LASER);
    expect(burner.burnTo({ index: 1, fraction: 0 })).toEqual({ firstRow: 1, rowCount: 1 });
    expect(burner.burnTo({ index: 2, fraction: 0 })).toEqual({ firstRow: 8, rowCount: 1 });
    expect(burner.burnTo({ index: 1, fraction: 0 })).toEqual({ firstRow: 0, rowCount: 10 });
    expect(burner.darkness[8 * 10 + 5]).toBe(0);
    expect(burner.darkness[1 * 10 + 5]).toBeGreaterThan(200);
  });

  it('lays the grid over the burn with room for the beam, at the surface burned', () => {
    const program = moves([[10, 20, 30, 25, 1000]], -1.5);
    const layout = burnLayout(program, LASER);
    expect(layout).toMatchObject({ originX: 10 - 1.1, originY: 20 - 1.1, z: -1.5 });
    expect(layout?.mmPerCell).toBe(0.05);
    expect((layout?.columns ?? 0) * 0.05).toBeGreaterThanOrEqual(20 + 2.2);
  });

  it('goes once round a rotary, a longer job burning over its own start', () => {
    const rotary = { ...LASER, wrapYMm: 50 };
    const program = moves([
      [0, 0, 0, 0.001, 1000],
      [5, 10.02, 6, 10.02, 1000],
      [5, 60.02, 6, 60.02, 1000],
    ]);
    const layout = burnLayout(program, rotary);
    if (layout === null) throw new Error('no burn');
    expect(layout.rows * layout.mmPerCell).toBeCloseTo(50, 9);
    expect(layout.originY).toBe(0);
    const burner = createBurner(layout, program, rotary);
    burner.burnTo({ index: 3, fraction: 0 });
    const column = Math.floor((5.5 - layout.originX) / layout.mmPerCell);
    const row = Math.floor(10.02 / layout.mmPerCell);
    // Burned twice: once, and again a turn later.
    expect(burner.darkness[row * layout.columns + column]).toBe(
      Math.round(255 * (1 - 0.08 * 0.08)),
    );
  });
});

describe('shading the burn by energy (ADR-501)', () => {
  // A 10 W laser on wood, burned fully by 2 J/mm².
  const ENERGY: BurnLaser = {
    ...LASER,
    shading: { by: 'energy', opticalPowerW: 10, fullDoseJPerMm2: 2 },
  };

  it('burns as the power shading does where the dose follows the power', () => {
    // 10 W, 0.1 mm beam, 50 mm/s: full power is 2 J/mm², the full burn.
    const full = burned([[0, 0.55, 1, 0.55, 1000, 3000]], GRID, ENERGY);
    expect(full(4, 5)).toBe(Math.round(255 * 0.92));
    const half = burned([[0, 0.55, 1, 0.55, 500, 3000]], GRID, ENERGY);
    expect(half(4, 5)).toBe(Math.round(255 * 0.46));
  });

  it('burns lighter faster and darker slower at the same power', () => {
    const at = (feed: number) => burned([[0, 0.55, 1, 0.55, 500, feed]], GRID, ENERGY)(4, 5);
    // Twice the speed halves the dose: 0.5 J/mm² leaves 77% of the light.
    expect(at(6000)).toBe(Math.round(255 * 0.23));
    expect(at(1500)).toBe(Math.round(255 * 0.92));
    expect(at(6000)).toBeLessThan(at(3000));
    const power = burned([[0, 0.55, 1, 0.55, 500, 6000]])(4, 5);
    expect(power).toBe(Math.round(255 * 0.46));
  });

  it('needs more energy for a material that burns harder', () => {
    const acrylic: BurnLaser = {
      ...LASER,
      shading: { by: 'energy', opticalPowerW: 10, fullDoseJPerMm2: 4 },
    };
    expect(burned([[0, 0.55, 1, 0.55, 1000, 3000]], GRID, acrylic)(4, 5)).toBe(
      Math.round(255 * 0.46),
    );
  });

  it('burns nothing on a move with no feed', () => {
    expect(burned([[0, 0.55, 1, 0.55, 1000, 0]], GRID, ENERGY)(4, 5)).toBe(0);
  });

  it('reads the least and most energy the program puts in', () => {
    const program = moves([
      [0, 0, 1, 0, 1000, 3000],
      [0, 1, 1, 1, 0, 3000],
      [0, 2, 1, 2, 250, 6000],
    ]);
    const range = burnDoseRange(program, LASER, 10);
    expect(range?.min).toBeCloseTo(0.25);
    expect(range?.max).toBeCloseTo(2);
    expect(burnDoseRange(moves([[0, 0, 1, 0, 0]]), LASER, 10)).toBeNull();
  });
});
