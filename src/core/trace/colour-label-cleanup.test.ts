// Speck absorption of the colour-layer label map (ADR-430).
import { describe, expect, it } from 'vitest';
import { absorbSmallRegions } from './colour-label-cleanup';

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
});
