import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { textToPolylines } from './text-to-polylines';

// Load Roboto once for the whole suite. Same font the app ships;
// gives us a real renderer to assert against without mocking.
const robotoPath = resolve(__dirname, '../../ui/text/fonts/Roboto-Regular.ttf');
const robotoBuffer = readFileSync(robotoPath).buffer.slice(0) as ArrayBuffer;

// Variable-font smoke check — Dancing Script ships as a variable
// `[wght]` TTF. opentype.js 2.0 supports VF for default-instance
// rendering, but a corrupted download (e.g., GitHub error HTML
// disguised as .ttf) makes opentype throw "unsupported OpenType
// signature". This test catches that regression.
const dancingPath = resolve(__dirname, '../../ui/text/fonts/DancingScript-Regular.ttf');
const dancingBuffer = readFileSync(dancingPath).buffer.slice(0) as ArrayBuffer;

function render(
  content: string,
  overrides: Partial<{
    sizeMm: number;
    alignment: 'left' | 'center' | 'right';
    lineHeight: number;
    color: string;
  }> = {},
) {
  return textToPolylines({
    fontBuffer: robotoBuffer,
    content,
    sizeMm: overrides.sizeMm ?? 10,
    alignment: overrides.alignment ?? 'left',
    lineHeight: overrides.lineHeight ?? 1.4,
    color: overrides.color ?? '#000000',
  });
}

describe('textToPolylines', () => {
  it('produces a single ColoredPath with the requested color', () => {
    const r = render('AB');
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]?.color).toBe('#000000');
  });

  it('respects a custom color', () => {
    const r = render('X', { color: '#ff00ff' });
    expect(r.paths[0]?.color).toBe('#ff00ff');
  });

  it('"AB" produces multiple polylines (each glyph has at least one contour)', () => {
    const r = render('AB');
    // A has 2 contours (outer + counter), B has 3. Minimum 2 polylines.
    expect(r.paths[0]?.polylines.length).toBeGreaterThanOrEqual(2);
  });

  it('empty content produces no polylines and zero-area bounds', () => {
    const r = render('');
    expect(r.paths[0]?.polylines.length).toBe(0);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('whitespace-only content has zero polylines (space has no contours)', () => {
    const r = render('   ');
    expect(r.paths[0]?.polylines.length).toBe(0);
  });

  it('bounds width grows with content length (each character widens the box)', () => {
    const one = render('A').bounds;
    const six = render('AAAAAA').bounds;
    expect(six.maxX - six.minX).toBeGreaterThan(one.maxX - one.minX);
  });

  it('size doubles the width (scale invariant for the same text)', () => {
    const small = render('Hello', { sizeMm: 10 });
    const large = render('Hello', { sizeMm: 20 });
    const smallW = small.bounds.maxX - small.bounds.minX;
    const largeW = large.bounds.maxX - large.bounds.minX;
    expect(largeW / smallW).toBeCloseTo(2, 1);
  });

  it('multi-line content adds vertical extent proportional to lineHeight', () => {
    const one = render('Hello').bounds;
    const two = render('Hello\nHello', { lineHeight: 1.4 }).bounds;
    const oneH = one.maxY - one.minY;
    const twoH = two.maxY - two.minY;
    // Two lines should be roughly 2x tall (one line + lineHeight * size for the second).
    expect(twoH).toBeGreaterThan(oneH * 1.5);
  });

  it('alignment center shifts the geometry rightward for short lines vs left', () => {
    // Two-line content: "X" and "XXXX". Left-aligned, "X" starts at x=0.
    // Centered, "X" gets shifted right to match "XXXX"'s width.
    const left = render('X\nXXXX', { alignment: 'left' });
    const centered = render('X\nXXXX', { alignment: 'center' });
    // Find the leftmost x of the first line (the "X")
    const firstLineLeftMostLeft = leftmostXOfFirstLine(left.paths[0]?.polylines ?? []);
    const firstLineLeftMostCenter = leftmostXOfFirstLine(centered.paths[0]?.polylines ?? []);
    expect(firstLineLeftMostCenter).toBeGreaterThan(firstLineLeftMostLeft);
  });

  it('alignment right shifts a short line further than center does', () => {
    const centered = render('X\nXXXX', { alignment: 'center' });
    const right = render('X\nXXXX', { alignment: 'right' });
    const c = leftmostXOfFirstLine(centered.paths[0]?.polylines ?? []);
    const r = leftmostXOfFirstLine(right.paths[0]?.polylines ?? []);
    expect(r).toBeGreaterThan(c);
  });

  it('"H" produces sensible bounds — height roughly equal to size', () => {
    // Roboto "H" cap height ≈ 0.7 × em. A 100mm "H" should be ~70mm tall.
    const r = render('H', { sizeMm: 100 });
    const h = r.bounds.maxY - r.bounds.minY;
    expect(h).toBeGreaterThan(50);
    expect(h).toBeLessThan(110);
  });

  it('letter spacing widens the bounds proportionally (D.1 polish)', () => {
    // letterSpacing is a multiplier of sizeMm added per glyph by
    // opentype's getPath. "HELLO" has 5 glyphs → 4 gaps. At sizeMm=10
    // and letterSpacing=0.5, the line should be ~20mm wider than at
    // letterSpacing=0 (4 gaps × 5mm extra each).
    const tight = render('HELLO', { sizeMm: 10 });
    const wide = render('HELLO', { sizeMm: 10 });
    const wideSpaced = textToPolylines({
      fontBuffer: robotoBuffer,
      content: 'HELLO',
      sizeMm: 10,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0.5,
      color: '#000000',
    });
    const tightW = tight.bounds.maxX - tight.bounds.minX;
    const wideW = wideSpaced.bounds.maxX - wideSpaced.bounds.minX;
    // 4 gaps × 0.5 × 10mm = 20mm extra. Allow ±2mm slop for the
    // last-glyph trailing edge.
    expect(wideW - tightW).toBeGreaterThan(15);
    expect(wideW - tightW).toBeLessThan(25);
    // sanity: passing the same value twice gives the same result
    expect(wide.bounds.maxX).toBeCloseTo(tight.bounds.maxX, 5);
  });

  it('parses Dancing Script (variable font) and produces drawable polylines', () => {
    // Regression for the github-error-html-as-ttf bug: an invalid
    // font binary throws "unsupported OpenType signature" inside
    // opentype.parse. Verify the bundled DancingScript-Regular.ttf
    // is a real font and renders.
    const r = textToPolylines({
      fontBuffer: dancingBuffer,
      content: 'Aa',
      sizeMm: 20,
      alignment: 'left',
      lineHeight: 1.4,
      color: '#000000',
    });
    expect(r.paths[0]?.polylines.length).toBeGreaterThan(0);
    expect(r.bounds.maxX - r.bounds.minX).toBeGreaterThan(0);
  });
});

// Leftmost x of any polyline whose vertices lie in the upper half of
// the result — used to locate the first text line in a multi-line
// render. Crude but deterministic enough for alignment tests.
function leftmostXOfFirstLine(
  polylines: ReadonlyArray<{ points: ReadonlyArray<{ x: number; y: number }> }>,
): number {
  let yMin = Number.POSITIVE_INFINITY;
  for (const pl of polylines) {
    for (const p of pl.points) {
      if (p.y < yMin) yMin = p.y;
    }
  }
  const yThreshold = yMin + 5; // 5mm slack — first line should be tight
  let xMin = Number.POSITIVE_INFINITY;
  for (const pl of polylines) {
    for (const p of pl.points) {
      if (p.y <= yThreshold && p.x < xMin) xMin = p.x;
    }
  }
  return xMin;
}
