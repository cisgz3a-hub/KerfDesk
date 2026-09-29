import { describe, expect, it } from 'vitest';
import { SEG_KIND } from '../../core/gcode-view';
import {
  burnDoseRange,
  createBurner,
  moveDoseJPerMm2,
  type BurnLaser,
  type BurnMoves,
} from './burn-grid';

// A 60 mm chuck turns once for 40 machine Y mm. X remains surface millimetres.
const SURFACE_Y_SCALE = (Math.PI * 60) / 40;
const LASER: BurnLaser = { maxPowerS: 1000, spotMm: 0.1, surfaceYScale: SURFACE_Y_SCALE };

function move(x: number, y: number, z = 0): BurnMoves {
  return {
    segmentCount: 1,
    positions: new Float32Array([0, 0, 0, x, y, z]),
    segKind: new Uint8Array([SEG_KIND.cut]),
    segPower: new Float32Array([1000]),
    segFeed: new Float32Array([3000]),
  };
}

describe('rotary burn energy in surface units', () => {
  it.each([
    { x: 10, y: 0, expected: 2 },
    { x: 0, y: 10, expected: 0.42441318157838753 },
    // 0.1 seconds over a sqrt(3^2 + (6*pi)^2) * .1 mm2 strip.
    { x: 3, y: 4, expected: 0.5239224182586328 },
    { x: 0, y: -10, expected: 0.42441318157838753 },
  ])('converts the programmed feed for X$x Y$y', ({ x, y, expected }) => {
    // E = watts * travel time / surface strip area. These expected values
    // are independent of the production feed-conversion implementation.
    expect(moveDoseJPerMm2(move(x, y), LASER, 0, 10)).toBeCloseTo(expected, 10);
  });

  it('includes commanded Z travel in the duration, not in the surface strip', () => {
    // A 3-4-5 XYZ move takes 0.1 s and covers 3 * 0.1 mm2: 10 J/s * .1 / .3.
    expect(moveDoseJPerMm2(move(3, 0, 4), LASER, 0, 10)).toBeCloseTo(10 / 3, 10);
    expect(moveDoseJPerMm2(move(0, 0, 4), LASER, 0, 10)).toBe(0);
    expect(moveDoseJPerMm2(move(0, 0), LASER, 0, 10)).toBe(0);
  });

  it('keeps the same dose with the display wrapped or flat', () => {
    const program = move(0, 10);
    const wrapped = { ...LASER, wrapYMm: 40 };
    expect(burnDoseRange(program, wrapped, 10)).toEqual(burnDoseRange(program, LASER, 10));
    expect(burnDoseRange(program, wrapped, 10)?.max).toBeCloseTo(0.42441318157838753, 10);
    expect(moveDoseJPerMm2(program, { maxPowerS: 1000, spotMm: 0.1 }, 0, 10)).toBe(2);
  });

  it('deposits the corrected dose in the burn grid', () => {
    const program = move(0, 1);
    const laser: BurnLaser = {
      ...LASER,
      shading: { by: 'energy', opticalPowerW: 10, fullDoseJPerMm2: 2 },
    };
    const burner = createBurner(
      { originX: -0.05, originY: 0, mmPerCell: 0.1, columns: 1, rows: 10, z: 0 },
      program,
      laser,
    );
    burner.burnTo({ index: 1, fraction: 0 });
    // 0.424413 J/mm2 is 21.22% of wood's full dose, leaving 80.48% light.
    expect(burner.darkness[5]).toBe(50);
  });
});
