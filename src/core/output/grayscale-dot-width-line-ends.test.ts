// Quality audit Q1-P1-1, ADR-458 Amendment 1: Dot Width Correction shortens a
// burned line where the beam turns on and off. It used to trim every change of
// exact power too, so a Grayscale gradient at 10 lines/mm burned 0.60 / 0.20 of
// its energy at Dot Width 0.02 / 0.04 mm while the Preview showed all of it.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { compileJob } from '../job/compile-job';
import { emitRasterGroup } from '../raster';
import { encodeCanonicalBase64 } from '../relief/depth-map-base64';
import { createLayer, IDENTITY_TRANSFORM, type RasterImage } from '../scene';
import { grblStrategy } from './grbl-strategy';

const WIDTH = 256;
const ROWS = 2;
const PIXEL_MM = 0.1;

// Black on the left to white on the right, the same on every row.
function gradient(): RasterImage {
  const luma = Uint8Array.from({ length: WIDTH * ROWS }, (_, index) => index % WIDTH);
  return {
    kind: 'raster-image',
    id: 'R1',
    source: 'gradient.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    lumaBase64: encodeCanonicalBase64(luma),
    pixelWidth: WIDTH,
    pixelHeight: ROWS,
    bounds: { minX: 0, minY: 0, maxX: WIDTH * PIXEL_MM, maxY: ROWS * PIXEL_MM },
    transform: IDENTITY_TRANSFORM,
    color: '#808080',
    dither: 'grayscale',
    linesPerMm: 10,
  };
}

type Burn = { readonly fromX: number; readonly toX: number; readonly s: number };

/** Every powered feed move of the program, read as a controller would. */
function burns(gcode: string): Burn[] {
  const out: Burn[] = [];
  let motion = 0;
  let x = 0;
  let s = 0;
  for (const raw of gcode.split('\n')) {
    const text = raw.replace(/\(.*?\)|;.*$/g, '').toUpperCase();
    const g = /G0*([01])(?!\d)/.exec(text);
    if (g !== null) motion = Number(g[1]);
    const sWord = /S(-?[\d.]+)/.exec(text);
    if (sWord !== null) s = Number(sWord[1]);
    const xWord = /X(-?[\d.]+)/.exec(text);
    if (xWord === null) continue;
    const nextX = Number(xWord[1]);
    if (motion === 1 && s > 0 && nextX !== x) out.push({ fromX: x, toX: nextX, s });
    x = nextX;
  }
  return out;
}

function energy(list: ReadonlyArray<Burn>): number {
  return list.reduce((sum, burn) => sum + burn.s * Math.abs(burn.toX - burn.fromX), 0);
}

function emitGradient(dotWidthCorrectionMm: number): string {
  const layer = {
    ...createLayer({ id: 'photo', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm: 'grayscale' as const,
    linesPerMm: 10,
    power: 100,
    minPower: 0,
    dotWidthCorrectionMm,
  };
  const job = compileJob({ objects: [gradient()], layers: [layer] }, DEFAULT_DEVICE_PROFILE);
  return grblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
}

describe('Grayscale with Dot Width Correction (Q1-P1-1, ADR-458 Amendment 1)', () => {
  const uncorrected = burns(emitGradient(0));
  const powers = uncorrected.map((burn) => burn.s);

  it('keeps each power change and shortens only the ends of the burned line', () => {
    const out = emitRasterGroup({
      sValues: Uint16Array.of(0, 500, 300, 700, 0),
      width: 5,
      height: 1,
      bounds: { minX: 0, minY: 0, maxX: 5, maxY: 1 },
      feedMmPerMin: 6000,
      overscanMm: 0,
      dotWidthCorrectionMm: 0.25,
      layerId: 'L1',
      color: '#000000',
      powerPercent: 80,
    });
    expect(out.split('\n').filter((line) => line.startsWith('G'))).toEqual([
      'G0 X1.000 Y0.500 S0',
      'G1 X1.250 F6000 S0',
      'G1 X2.000 S500',
      'G1 X3.000 S300',
      'G1 X3.750 S700',
      'G1 X4.000 S0',
    ]);
  });

  it('changes power at every pixel edge without dark gaps', () => {
    const corrected = burns(emitGradient(0.02));
    // One powered move per pixel whose S differs from its neighbour's.
    expect(corrected).toHaveLength(uncorrected.length);
    for (const [index, burn] of corrected.entries()) {
      expect(burn.s).toBe(uncorrected[index]?.s);
    }
    // Inside a row each burn starts where the previous one stopped.
    const forwardRow = corrected.filter((burn) => burn.toX > burn.fromX);
    for (let index = 1; index < forwardRow.length; index += 1) {
      expect(forwardRow[index]?.fromX).toBe(forwardRow[index - 1]?.toX);
    }
  });

  it.each([0.02, 0.04])('loses only the two end trims of each line at %s mm', (dwc) => {
    const corrected = burns(emitGradient(dwc));
    // Each row's line starts at the black end and stops at the last pixel
    // darker than white; the second row runs the same line in reverse.
    const lostPerRow = dwc * (Math.max(...powers) + Math.min(...powers));
    expect(energy(uncorrected) - energy(corrected)).toBeCloseTo(ROWS * lostPerRow, 6);
    // Before Amendment 1: 0.60 at 0.02 mm and 0.20 at 0.04 mm.
    expect(energy(corrected) / energy(uncorrected)).toBeGreaterThan(0.99);
  });
});
