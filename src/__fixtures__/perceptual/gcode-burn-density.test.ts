// Unit tests for the raster fidelity instrument itself. The fidelity suite is
// only as trustworthy as its measuring device, so the density definition is
// pinned here against hand-computable G-code rather than compiled output.

import { describe, expect, it } from 'vitest';
import { compareDensityFields } from './density-compare';
import { fullPowerS, gcodeBurnDensity, type MachineRect } from './gcode-burn-density';
import { imageDensityTruth } from './image-density-truth';

const WINDOW: MachineRect = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
const S_MAX = 1000;

function density(gcode: string, cells = 1): readonly number[] {
  return Array.from(
    gcodeBurnDensity(gcode, {
      window: WINDOW,
      cellsX: cells,
      cellsY: cells,
      sMax: S_MAX,
      lineIntervalMm: 1,
    }).data,
  );
}

describe('gcodeBurnDensity', () => {
  it('scores a full-power full-coverage burn as exactly 1', () => {
    // 4 mm × 4 mm cell, 1 mm scan rows: four full-width passes at S=sMax is
    // everything the cell can absorb.
    const gcode = [
      'M4 S0',
      'G0 X0 Y0.5 S0',
      'G1 X4 S1000',
      'G0 X0 Y1.5 S0',
      'G1 X4 S1000',
      'G0 X0 Y2.5 S0',
      'G1 X4 S1000',
      'G0 X0 Y3.5 S0',
      'G1 X4 S1000',
    ].join('\n');

    expect(density(gcode)).toEqual([1]);
  });

  it('scales linearly with S, so half power reads as half density', () => {
    const half = ['M4 S0', 'G0 X0 Y0.5 S0', 'G1 X4 S500'].join('\n');
    const full = ['M4 S0', 'G0 X0 Y0.5 S0', 'G1 X4 S1000'].join('\n');

    expect(density(half)).toEqual([0.125]);
    expect(density(full)).toEqual([0.25]);
  });

  it('scales linearly with covered length', () => {
    const gcode = ['M4 S0', 'G0 X0 Y0.5 S0', 'G1 X2 S1000'].join('\n');

    // Half the cell width, one of four rows: 0.5 × 0.25.
    expect(density(gcode)).toEqual([0.125]);
  });

  it('ignores rapids, S0 moves and everything after M5', () => {
    const gcode = [
      'M4 S0',
      'G0 X0 Y0.5 S0',
      'G0 X4 S1000', // rapid, never burns
      'G1 X0 S0', // armed but zero power
      'M5',
      'G1 X4 S1000', // laser off
    ].join('\n');

    expect(density(gcode)).toEqual([0]);
  });

  it('reports above 1 when a program asks for more energy than a cell can take', () => {
    // Eight full-power passes where four is the cell's capacity — a duplicated
    // pass bug. Saturating this to 1 would hide it, so the field does not.
    const row = ['G0 X0 Y0.5 S0', 'G1 X4 S1000'];
    const gcode = ['M4 S0', ...row, ...row, ...row, ...row, ...row, ...row, ...row, ...row].join(
      '\n',
    );

    expect(density(gcode)).toEqual([2]);
  });

  it('places ink in the cell containing the move, not the one it started in', () => {
    const gcode = ['M4 S0', 'G0 X2 Y3.5 S0', 'G1 X4 S1000'].join('\n');

    // 2×2 grid over a 4 mm window: the burn is the top-right cell only.
    // Row 0 is low machine Y, so the top row is index 2..3.
    expect(density(gcode, 2)).toEqual([0, 0, 0, 0.5]);
  });

  it('rejects a grid or normalisation that would make the score meaningless', () => {
    const options = { window: WINDOW, cellsX: 1, cellsY: 1, sMax: S_MAX, lineIntervalMm: 1 };
    expect(() => gcodeBurnDensity('', { ...options, cellsX: 0 })).toThrow(/invalid grid/);
    expect(() => gcodeBurnDensity('', { ...options, sMax: 0 })).toThrow(/sMax/);
    expect(() => gcodeBurnDensity('', { ...options, lineIntervalMm: 0 })).toThrow(/lineIntervalMm/);
  });
});

describe('fullPowerS', () => {
  it('matches the compiler power-scale invariant', () => {
    expect(fullPowerS(40, 1000)).toBe(400);
    expect(fullPowerS(30, 255)).toBe(77);
  });
});

describe('imageDensityTruth', () => {
  const grid = { window: WINDOW, cellsX: 2, cellsY: 2 };
  const rect: MachineRect = { minX: 0, minY: 0, maxX: 4, maxY: 4 };

  it('reads mid grey as half ink under the linear tone', () => {
    const luma = Uint8Array.from([128, 128, 128, 128]);

    const field = imageDensityTruth({ luma, width: 2, height: 2, rect, tone: 'linear' }, grid);

    expect(Array.from(field.data).map((v) => Number(v.toFixed(4)))).toEqual([
      0.498, 0.498, 0.498, 0.498,
    ]);
  });

  it('reads mid grey as full ink under the threshold tone', () => {
    // 127 is below the 128 cutoff, so it is a burn pixel, not a 50% one. This
    // is exactly why the tone is a required argument: scoring a threshold
    // dither against the linear truth above would report a 50% error on
    // perfectly correct output.
    const luma = Uint8Array.from([127, 127, 127, 127]);

    const field = imageDensityTruth({ luma, width: 2, height: 2, rect, tone: 'threshold' }, grid);

    expect(Array.from(field.data)).toEqual([1, 1, 1, 1]);
  });

  it('puts source row 0 at the back of the bed by default', () => {
    const luma = Uint8Array.from([0, 0, 255, 255]); // top row black

    const field = imageDensityTruth({ luma, width: 2, height: 2, rect, tone: 'threshold' }, grid);

    // Cell row 0 is low machine Y (front); the ink belongs at high machine Y.
    expect(Array.from(field.data)).toEqual([0, 0, 1, 1]);
  });

  it('honours an explicit min-y row origin for flipped rasters', () => {
    const luma = Uint8Array.from([0, 0, 255, 255]);

    const field = imageDensityTruth(
      { luma, width: 2, height: 2, rect, tone: 'threshold', rowZeroAt: 'min-y' },
      grid,
    );

    expect(Array.from(field.data)).toEqual([1, 1, 0, 0]);
  });
});

describe('compareDensityFields', () => {
  const grid = { window: WINDOW, cellsX: 2, cellsY: 2 };
  const rect: MachineRect = { minX: 0, minY: 0, maxX: 4, maxY: 4 };
  const truth = (values: readonly number[]) =>
    imageDensityTruth(
      {
        luma: Uint8Array.from(values, (v) => 255 - Math.round(v * 255)),
        width: 2,
        height: 2,
        rect,
        tone: 'linear',
        rowZeroAt: 'min-y',
      },
      grid,
    );

  it('reports zero error and unit correlation for identical fields', () => {
    const field = truth([0, 0.5, 1, 0.25]);

    const metrics = compareDensityFields(field, field);

    expect(metrics.meanAbsoluteError).toBe(0);
    expect(metrics.correlation).toBeCloseTo(1, 10);
  });

  it('reports negative correlation for an inverted field', () => {
    const metrics = compareDensityFields(truth([0, 0.5, 1, 0.25]), truth([1, 0.5, 0, 0.75]));

    expect(metrics.correlation).toBeLessThan(-0.99);
  });

  it('reports zero correlation rather than NaN for a flat field', () => {
    const metrics = compareDensityFields(truth([0.5, 0.5, 0.5, 0.5]), truth([0, 0.5, 1, 0.25]));

    expect(metrics.correlation).toBe(0);
  });

  it('refuses to compare mismatched grids', () => {
    const small = imageDensityTruth(
      { luma: Uint8Array.from([0]), width: 1, height: 1, rect, tone: 'linear' },
      { window: WINDOW, cellsX: 1, cellsY: 1 },
    );

    expect(() => compareDensityFields(small, truth([0, 0, 0, 0]))).toThrow(/grid mismatch/);
  });
});
