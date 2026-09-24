// Fine white detail survives the burn grid (ADR-359).
//
// Line art is usually imported far denser than the burn grid (a 4000-8000 px
// wing placed at 100-200 mm is 25-60 px/mm against 10 lines/mm). The former
// nearest-neighbour resample gave each burn cell ONE source pixel, so a white
// hatch line narrower than a cell was either deleted outright — the feather
// burned solid black there — or kept a whole cell wide, depending only on
// where the sample landed. The canvas drew every line either way. These tests
// drive the real compile path and require every line to leave white in the
// cells it covers, in proportion to its width.

import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { originFlipsRasterX } from '../raster-output';
import { createLayer, IDENTITY_TRANSFORM, type DitherAlgorithm, type RasterImage } from '../scene';
import { compileRasterGroupsForLayer } from './compile-job-raster';
import type { RasterGroup } from './job';

const DEVICE = DEFAULT_DEVICE_PROFILE;
const SOURCE_PX_PER_MM = 40;
const LINES_PER_MM = 10;
const CELL_SOURCE_PX = SOURCE_PX_PER_MM / LINES_PER_MM;
const WIDTH_MM = 20;
const HEIGHT_MM = 5;
const SOURCE_W = WIDTH_MM * SOURCE_PX_PER_MM;
const SOURCE_H = HEIGHT_MM * SOURCE_PX_PER_MM;
const BLACK = 0;
const WHITE = 255;

type WhiteLine = { readonly start: number; readonly width: number };

// White lines 1-3 source px wide (0.025-0.075 mm, all narrower than one
// 0.1 mm burn cell) separated by 10-13 px of black, so their phase against
// the 4 px cell drifts across every alignment.
function hatchLines(): ReadonlyArray<WhiteLine> {
  const lines: WhiteLine[] = [];
  let x = 5;
  for (let i = 0; x + 3 < SOURCE_W - 5; i += 1) {
    const width = 1 + (i % 3);
    lines.push({ start: x, width });
    x += width + 10 + (i % 4);
  }
  return lines;
}

function hatchLuma(lines: ReadonlyArray<WhiteLine>): Uint8Array {
  const luma = new Uint8Array(SOURCE_W * SOURCE_H).fill(BLACK);
  for (let y = 0; y < SOURCE_H; y += 1) {
    for (const line of lines) {
      luma.fill(WHITE, y * SOURCE_W + line.start, y * SOURCE_W + line.start + line.width);
    }
  }
  return luma;
}

function hatchImage(luma: Uint8Array, rotationDeg = 0): RasterImage {
  return {
    kind: 'raster-image',
    id: 'wing',
    source: 'wing.png',
    dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    pixelWidth: SOURCE_W,
    pixelHeight: SOURCE_H,
    bounds: { minX: 0, minY: 0, maxX: WIDTH_MM, maxY: HEIGHT_MM },
    transform: { ...IDENTITY_TRANSFORM, x: 50, y: 50, rotationDeg },
    color: '#808080',
    dither: 'floyd-steinberg',
    linesPerMm: LINES_PER_MM,
    lumaBase64: Buffer.from(luma).toString('base64'),
  };
}

function compileHatch(
  image: RasterImage,
  ditherAlgorithm: DitherAlgorithm = 'floyd-steinberg',
): RasterGroup {
  const layer = {
    ...createLayer({ id: 'image', color: '#808080', mode: 'image' as const }),
    ditherAlgorithm,
    linesPerMm: LINES_PER_MM,
  };
  const { groups } = compileRasterGroupsForLayer([image], layer, DEVICE);
  const group = groups[0];
  if (group === undefined) throw new Error('expected one raster group');
  return group;
}

function isUnburned(group: RasterGroup, x: number, y: number): boolean {
  return (group.sValues[y * group.pixelWidth + x] ?? 1) === 0;
}

describe('image-mode burn grid keeps sub-cell white lines', () => {
  it('leaves every white line narrower than a burn cell unburned in proportion to its width', () => {
    const lines = hatchLines();
    const group = compileHatch(hatchImage(hatchLuma(lines)));
    expect(group.pixelWidth).toBe(WIDTH_MM * LINES_PER_MM);
    expect(group.pixelHeight).toBe(HEIGHT_MM * LINES_PER_MM);
    const flipX = originFlipsRasterX(DEVICE);

    const lost: string[] = [];
    for (const line of lines) {
      const firstCell = Math.floor(line.start / CELL_SOURCE_PX);
      const lastCell = Math.floor((line.start + line.width - 1) / CELL_SOURCE_PX);
      let unburned = 0;
      for (let cell = firstCell; cell <= lastCell; cell += 1) {
        const column = flipX ? group.pixelWidth - 1 - cell : cell;
        for (let y = 0; y < group.pixelHeight; y += 1) {
          if (isUnburned(group, column, y)) unburned += 1;
        }
      }
      // A line w source px wide carries w/4 of a cell of white down every row.
      const expected = (line.width / CELL_SOURCE_PX) * group.pixelHeight;
      if (unburned < 0.5 * expected) {
        lost.push(`x=${line.start} w=${line.width}px: ${unburned} of ~${expected} white cells`);
      }
    }
    expect(lost).toEqual([]);
  });

  it('keeps the image white area, so fine hatch burns as texture rather than solid black', () => {
    const lines = hatchLines();
    const luma = hatchLuma(lines);
    const group = compileHatch(hatchImage(luma));
    const sourceWhite = luma.reduce((n, v) => n + (v === WHITE ? 1 : 0), 0) / luma.length;
    let unburned = 0;
    for (const s of group.sValues) if (s === 0) unburned += 1;
    const burnWhite = unburned / group.sValues.length;

    expect(sourceWhite).toBeGreaterThan(0.1);
    expect(Math.abs(burnWhite - sourceWhite)).toBeLessThan(0.02);
  });

  it('keeps sub-cell white lines that run along the scan rows', () => {
    const lines = hatchLines().filter((line) => line.start + line.width < SOURCE_H);
    // Transpose the hatch so every line is horizontal: rows, not columns, now
    // have to average the sub-cell white into the cells that cover it.
    const luma = new Uint8Array(SOURCE_W * SOURCE_H).fill(BLACK);
    for (const line of lines)
      luma.fill(WHITE, line.start * SOURCE_W, (line.start + line.width) * SOURCE_W);
    const group = compileHatch(hatchImage(luma), 'grayscale');
    const sMax = Math.max(...group.sValues);

    let rowsWithWhite = 0;
    for (let y = 0; y < group.pixelHeight; y += 1) {
      let power = 0;
      for (let x = 0; x < group.pixelWidth; x += 1) {
        power += group.sValues[y * group.pixelWidth + x] ?? sMax;
      }
      if (1 - power / (sMax * group.pixelWidth) >= 0.2) rowsWithWhite += 1;
    }
    expect(lines.length).toBeGreaterThan(8);
    expect(rowsWithWhite).toBeGreaterThanOrEqual(lines.length);
  });

  it('keeps sub-cell white lines on a rotated image too', () => {
    const lines = hatchLines();
    // A quarter turn lays the vertical source lines along the machine scan
    // rows, where the rotated sampler (not the axis-aligned resample) runs.
    // Grayscale output maps each cell's sampled luma straight to power, so it
    // shows the sampler's coverage without error diffusion moving white
    // between neighbouring rows.
    const group = compileHatch(hatchImage(hatchLuma(lines), 90), 'grayscale');
    expect(group.pixelHeight).toBe(WIDTH_MM * LINES_PER_MM);
    const sMax = Math.max(...group.sValues);

    let rowsWithWhite = 0;
    for (let y = 0; y < group.pixelHeight; y += 1) {
      let power = 0;
      for (let x = 0; x < group.pixelWidth; x += 1) {
        power += group.sValues[y * group.pixelWidth + x] ?? sMax;
      }
      // Every line is 1-3 px of a 4 px cell, so its row(s) carry >= 1/4 white.
      if (1 - power / (sMax * group.pixelWidth) >= 0.2) rowsWithWhite += 1;
    }
    expect(rowsWithWhite).toBeGreaterThanOrEqual(lines.length);
    expect(rowsWithWhite).toBeLessThanOrEqual(2 * lines.length);
  });
});
