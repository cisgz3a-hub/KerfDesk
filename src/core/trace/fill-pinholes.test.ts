// fill-pinholes tests — the discriminator matters more than the fill:
// binarization cracks (thin slivers enclosed by ink) must be filled, while
// real art that shares one property with them must survive:
//   * letter counters   — enclosed but FAT       (Arch House 'A': 70-151 px)
//   * water ripples     — enclosed, thin-ish but BIG (186-258 px)
//   * letter spacing    — thin but NOT enclosed (connects to background)
// Sizes come from the arch-house pinhole audit, not guesses.

import { describe, expect, it } from 'vitest';
import type { RawImageData } from './trace-image';
import { fillPinholes } from './fill-pinholes';

const WHITE = 255;
const BLACK = 0;

function imageFromRows(rows: ReadonlyArray<string>): RawImageData {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = rows[y]?.[x] === '#' ? BLACK : WHITE;
      const base = (y * width + x) * 4;
      data[base] = value;
      data[base + 1] = value;
      data[base + 2] = value;
      data[base + 3] = 255;
    }
  }
  return { width, height, data };
}

function rowsFromImage(image: RawImageData): string[] {
  const rows: string[] = [];
  for (let y = 0; y < image.height; y += 1) {
    let row = '';
    for (let x = 0; x < image.width; x += 1) {
      row += (image.data[(y * image.width + x) * 4] ?? WHITE) < 128 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

function solidBlock(width: number, height: number): string[] {
  return Array.from({ length: height }, () => '#'.repeat(width));
}

function withVerticalSlit(
  rows: string[],
  slitX: number,
  slitWidth: number,
  y0: number,
  y1: number,
): string[] {
  return rows.map((row, y) => {
    if (y < y0 || y >= y1) return row;
    return row.slice(0, slitX) + '.'.repeat(slitWidth) + row.slice(slitX + slitWidth);
  });
}

describe('fillPinholes', () => {
  it('fills a hairline crack enclosed inside solid ink (the H-stem defect)', () => {
    const rows = withVerticalSlit(solidBlock(20, 40), 9, 2, 5, 35);
    const filled = fillPinholes(imageFromRows(rows));
    expect(rowsFromImage(filled)).toEqual(solidBlock(20, 40));
  });

  it('fills isolated pinhole ticks inside ink (the O-counter tick defect)', () => {
    const rows = solidBlock(12, 12).map((row, y) =>
      y === 6 ? row.slice(0, 5) + '..' + row.slice(7) : row,
    );
    const filled = fillPinholes(imageFromRows(rows));
    expect(rowsFromImage(filled)).toEqual(solidBlock(12, 12));
  });

  it('keeps a fat enclosed counter (letter bowls must never fill)', () => {
    // 8x8 white counter inside a ring: enclosed, area 64, but fat (radius 4).
    const rows = solidBlock(20, 20).map((row, y) => {
      if (y < 6 || y >= 14) return row;
      return row.slice(0, 6) + '.'.repeat(8) + row.slice(14);
    });
    const filled = fillPinholes(imageFromRows(rows));
    expect(rowsFromImage(filled)).toEqual(rows);
  });

  it('keeps a thin slit that touches the outside background (letter spacing)', () => {
    // Same hairline slit, but running through the block's top edge — it
    // connects to the border background, so it is spacing, not a pinhole.
    const rows = withVerticalSlit(solidBlock(20, 40), 9, 2, 0, 35);
    const filled = fillPinholes(imageFromRows(rows));
    expect(rowsFromImage(filled)).toEqual(rows);
  });

  it('keeps a long thin enclosed sliver above the area cap (water ripples)', () => {
    // 2px-wide, 100px-long slit = 200px area: thin, enclosed, but big enough
    // to be intended art (the audit's ripple highlights are 186-258 px).
    const rows = withVerticalSlit(solidBlock(10, 120), 4, 2, 5, 105);
    const filled = fillPinholes(imageFromRows(rows));
    expect(rowsFromImage(filled)).toEqual(rows);
  });

  it('leaves background-only images untouched and does not mutate its input', () => {
    const rows = ['....', '....', '....'];
    const input = imageFromRows(rows);
    const snapshot = Array.from(input.data);
    const filled = fillPinholes(input);
    expect(rowsFromImage(filled)).toEqual(rows);
    expect(Array.from(input.data)).toEqual(snapshot);
  });

  it('returns malformed buffers unchanged (fail closed)', () => {
    const malformed: RawImageData = {
      width: 4,
      height: 4,
      data: new Uint8ClampedArray(7),
    };
    expect(fillPinholes(malformed)).toBe(malformed);
  });

  it('scales its caps with pixelScale so supersampled cracks still fill', () => {
    // The H-stem crack at 2x supersample: 4px wide, 60px long = 240px area —
    // over BOTH 1x caps (radius 1, area 120) but exactly the same real-space
    // sliver. With pixelScale 2 the caps normalize and it fills.
    const rows = withVerticalSlit(solidBlock(40, 80), 18, 4, 10, 70);
    expect(rowsFromImage(fillPinholes(imageFromRows(rows), 2))).toEqual(solidBlock(40, 80));
    expect(rowsFromImage(fillPinholes(imageFromRows(rows)))).toEqual(rows);
  });

  it('keeps fat counters at pixelScale 2 (thinness still guards)', () => {
    // A 16x16 counter at 2x (8x8 real): enclosed, area 256 <= scaled cap,
    // but max inscribed radius 8 > scaled radius cap 2 — must survive.
    const rows = solidBlock(40, 40).map((row, y) => {
      if (y < 12 || y >= 28) return row;
      return row.slice(0, 12) + '.'.repeat(16) + row.slice(28);
    });
    expect(rowsFromImage(fillPinholes(imageFromRows(rows), 2))).toEqual(rows);
  });
});
