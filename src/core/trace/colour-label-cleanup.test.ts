// Speck absorption of the colour-layer label map (ADR-461).
import { describe, expect, it } from 'vitest';
import { absorbSmallRegions, modeFilterIsolatedPixels } from './colour-label-cleanup';

// A 12 x 12 field of label 3 holding two touching specks: A (label 1, 2 px)
// is wrapped on two sides by B (label 2, 6 px), and A scans first. A shares
// as much edge with B as with the field, so it joins B's label (ties go to
// the lower label).
function twoTouchingSpecks(): { readonly labels: Uint8Array; width: number; height: number } {
  const width = 12;
  const labels = new Uint8Array(width * width).fill(3);
  const set = (x: number, y: number, label: number): void => {
    labels[y * width + x] = label;
  };
  set(5, 5, 1);
  set(6, 5, 1);
  for (const [x, y] of [
    [7, 5],
    [7, 6],
    [6, 6],
    [5, 6],
    [4, 6],
    [4, 7],
  ] as const) {
    set(x, y, 2);
  }
  return { labels, width, height: width };
}

const count = (labels: Uint8Array, label: number): number =>
  labels.reduce((n, l) => n + (l === label ? 1 : 0), 0);

describe('absorbSmallRegions', () => {
  it('leaves no orphaned speck when two touching specks both move on', () => {
    // Together A and B hold 8 px, still under 12: all of it joins the field.
    const grid = twoTouchingSpecks();
    absorbSmallRegions(grid, 12);
    expect(count(grid.labels, 3)).toBe(144);
  });

  it('re-measures merged specks: joined, they can clear the speck area', () => {
    // 8 px >= 7: once A joins B the merged region is kept as one colour.
    const grid = twoTouchingSpecks();
    absorbSmallRegions(grid, 7);
    expect(count(grid.labels, 2)).toBe(8);
    expect(count(grid.labels, 1)).toBe(0);
  });

  it('keeps regions at or above the speck area and transparent specks', () => {
    const grid = twoTouchingSpecks();
    grid.labels[0] = 255;
    absorbSmallRegions(grid, 2);
    expect(count(grid.labels, 1)).toBe(2);
    expect(count(grid.labels, 2)).toBe(6);
    expect(grid.labels[0]).toBe(255);
  });

  it('measures a diagonal run as one region and still removes a short run', () => {
    for (const minArea of [6, 7]) {
      const grid = { width: 12, height: 12, labels: new Uint8Array(144).fill(0) };
      for (let i = 0; i < 6; i += 1) grid.labels[(i + 2) * 12 + i + 2] = 1;
      modeFilterIsolatedPixels(grid);
      expect(count(grid.labels, 1)).toBe(6);
      absorbSmallRegions(grid, minArea);
      expect(count(grid.labels, 1)).toBe(minArea === 6 ? 6 : 0);
    }
  });

  it('does not connect isolated specks across opposite row edges', () => {
    const grid = { width: 12, height: 12, labels: new Uint8Array(144).fill(0) };
    grid.labels[35] = 1;
    grid.labels[36] = 1;
    absorbSmallRegions(grid, 2);
    expect(count(grid.labels, 1)).toBe(0);
  });

  // ADR-461 Amendment 1: diagonal-only contact links line-like pixels, not
  // dither. Every pixel of a checkerboard or of a 4x4 ordered (Bayer) dither
  // at 7/16 has three or four same-label diagonals, so the pattern cleans up
  // to one label instead of staying one outline per pixel.
  it.each([
    ['checkerboard', (x: number, y: number) => (x + y) % 2],
    ['Bayer 7/16', (x: number, y: number) => (BAYER[(y % 4) * 4 + (x % 4)]! < 7 ? 1 : 0)],
    ['Bayer 6/16', (x: number, y: number) => (BAYER[(y % 4) * 4 + (x % 4)]! < 6 ? 1 : 0)],
  ] as const)('cleans a %s dither patch to one label', (_, labelAt) => {
    const width = 24;
    const grid = { width, height: width, labels: new Uint8Array(width * width) };
    for (let y = 0; y < width; y += 1)
      for (let x = 0; x < width; x += 1) grid.labels[y * width + x] = labelAt(x, y);
    modeFilterIsolatedPixels(grid);
    absorbSmallRegions(grid, 12);
    expect(Math.min(count(grid.labels, 0), count(grid.labels, 1))).toBe(0);
  });

  it('keeps a diagonal hairline crossing a straight one', () => {
    const width = 24;
    const grid = { width, height: width, labels: new Uint8Array(width * width) };
    for (let i = 2; i < 22; i += 1) {
      grid.labels[i * width + i] = 1;
      grid.labels[12 * width + i] = 1;
    }
    const drawn = count(grid.labels, 1);
    modeFilterIsolatedPixels(grid);
    absorbSmallRegions(grid, 12);
    expect(count(grid.labels, 1)).toBe(drawn);
  });
});

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
