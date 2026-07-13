import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { textToPolylines } from './text-to-polylines';

// Load Roboto once for the whole suite. Same font the app ships;
// gives us a real renderer to assert against without mocking.
const robotoBuffer = readFontBuffer('Roboto-Regular.ttf');

// Variable-font smoke check — Dancing Script ships as a variable
// `[wght]` TTF. opentype.js 2.0 supports VF for default-instance
// rendering, but a corrupted download (e.g., GitHub error HTML
// disguised as .ttf) makes opentype throw "unsupported OpenType
// signature". This test catches that regression.
const dancingBuffer = readFontBuffer('DancingScript-Regular.ttf');

function readFontBuffer(fileName: string): ArrayBuffer {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

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
  it('produces a single ColoredPath with the requested color', async () => {
    const r = await render('AB');
    expect(r.paths).toHaveLength(1);
    expect(r.paths[0]?.color).toBe('#000000');
  });

  it('respects a custom color', async () => {
    const r = await render('X', { color: '#ff00ff' });
    expect(r.paths[0]?.color).toBe('#ff00ff');
  });

  it('"AB" produces multiple polylines (each glyph has at least one contour)', async () => {
    const r = await render('AB');
    // A has 2 contours (outer + counter), B has 3. Minimum 2 polylines.
    expect(r.paths[0]?.polylines.length).toBeGreaterThanOrEqual(2);
  });

  it('preserves native cubic glyph outlines alongside compatibility polylines', async () => {
    const r = await render('S');
    const path = r.paths[0];
    expect(path?.curves).toHaveLength(path?.polylines.length ?? 0);
    expect(
      path?.curves?.some((curve) => curve.segments.some((segment) => segment.kind === 'cubic')),
    ).toBe(true);
    expect(path?.curves?.every((curve) => curve.closed)).toBe(true);
  });

  it('empty content produces no polylines and zero-area bounds', async () => {
    const r = await render('');
    expect(r.paths[0]?.polylines.length).toBe(0);
    expect(r.paths[0]?.curves).toEqual([]);
    expect(r.bounds).toEqual({ minX: 0, minY: 0, maxX: 0, maxY: 0 });
  });

  it('whitespace-only content has zero polylines (space has no contours)', async () => {
    const r = await render('   ');
    expect(r.paths[0]?.polylines.length).toBe(0);
  });

  it('bounds width grows with content length (each character widens the box)', async () => {
    const one = (await render('A')).bounds;
    const six = (await render('AAAAAA')).bounds;
    expect(six.maxX - six.minX).toBeGreaterThan(one.maxX - one.minX);
  });

  it('size doubles the width (scale invariant for the same text)', async () => {
    const small = await render('Hello', { sizeMm: 10 });
    const large = await render('Hello', { sizeMm: 20 });
    const smallW = small.bounds.maxX - small.bounds.minX;
    const largeW = large.bounds.maxX - large.bounds.minX;
    expect(largeW / smallW).toBeCloseTo(2, 1);
  });

  it('multi-line content adds vertical extent proportional to lineHeight', async () => {
    const one = (await render('Hello')).bounds;
    const two = (await render('Hello\nHello', { lineHeight: 1.4 })).bounds;
    const oneH = one.maxY - one.minY;
    const twoH = two.maxY - two.minY;
    // Two lines should be roughly 2x tall (one line + lineHeight * size for the second).
    expect(twoH).toBeGreaterThan(oneH * 1.5);
  });

  it('alignment center shifts the geometry rightward for short lines vs left', async () => {
    // Two-line content: "X" and "XXXX". Left-aligned, "X" starts at x=0.
    // Centered, "X" gets shifted right to match "XXXX"'s width.
    const left = await render('X\nXXXX', { alignment: 'left' });
    const centered = await render('X\nXXXX', { alignment: 'center' });
    // Find the leftmost x of the first line (the "X")
    const firstLineLeftMostLeft = leftmostXOfFirstLine(left.paths[0]?.polylines ?? []);
    const firstLineLeftMostCenter = leftmostXOfFirstLine(centered.paths[0]?.polylines ?? []);
    expect(firstLineLeftMostCenter).toBeGreaterThan(firstLineLeftMostLeft);
  });

  it('alignment right shifts a short line further than center does', async () => {
    const centered = await render('X\nXXXX', { alignment: 'center' });
    const right = await render('X\nXXXX', { alignment: 'right' });
    const c = leftmostXOfFirstLine(centered.paths[0]?.polylines ?? []);
    const r = leftmostXOfFirstLine(right.paths[0]?.polylines ?? []);
    expect(r).toBeGreaterThan(c);
  });

  it('"H" produces sensible bounds — height roughly equal to size', async () => {
    // Roboto "H" cap height ≈ 0.7 × em. A 100mm "H" should be ~70mm tall.
    const r = await render('H', { sizeMm: 100 });
    const h = r.bounds.maxY - r.bounds.minY;
    expect(h).toBeGreaterThan(50);
    expect(h).toBeLessThan(110);
  });

  it('letter spacing widens the bounds proportionally (D.1 polish)', async () => {
    // letterSpacing is a multiplier of sizeMm added per glyph by
    // opentype's getPath. "HELLO" has 5 glyphs → 4 gaps. At sizeMm=10
    // and letterSpacing=0.5, the line should be ~20mm wider than at
    // letterSpacing=0 (4 gaps × 5mm extra each).
    const tight = await render('HELLO', { sizeMm: 10 });
    const wide = await render('HELLO', { sizeMm: 10 });
    const wideSpaced = await textToPolylines({
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

  it('marks glyph contours as closed even when opentype.js omits Z (Fill-mode regression)', async () => {
    // opentype.js v2 emits the closing edge as a regular L back to the
    // contour start instead of a Z command. Without geometric closure
    // detection, every text polyline came out closed=false, which made
    // fillHatching reject them all and Frame in Fill mode said
    // "Nothing to frame." User-reported bug.
    const r = await render('O');
    const pls = r.paths[0]?.polylines ?? [];
    // The letter O has 2 contours (outer + inner). Both must be closed.
    expect(pls.length).toBeGreaterThanOrEqual(2);
    for (const pl of pls) {
      expect(pl.closed).toBe(true);
    }
  });

  it('parses Dancing Script (variable font) and produces drawable polylines', async () => {
    // Regression for the github-error-html-as-ttf bug: an invalid
    // font binary throws "unsupported OpenType signature" inside
    // opentype.parse. Verify the bundled DancingScript-Regular.ttf
    // is a real font and renders.
    const r = await textToPolylines({
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

  it('renders Latin diacritics with Dancing Script', async () => {
    const r = await textToPolylines({
      fontBuffer: dancingBuffer,
      content: 'Cr\u00e8me br\u00fbl\u00e9e',
      sizeMm: 20,
      alignment: 'left',
      lineHeight: 1.4,
      color: '#000000',
    });
    expect(r.paths[0]?.polylines.length).toBeGreaterThan(0);
    expect(r.bounds.maxX - r.bounds.minX).toBeGreaterThan(0);
  });

  it('retries the opentype dynamic import after a transient chunk failure', async () => {
    vi.resetModules();
    (globalThis as { __lfOpentypeAttempts?: number }).__lfOpentypeAttempts = 0;
    vi.doMock('opentype.js', () => {
      const state = globalThis as { __lfOpentypeAttempts?: number };
      const attempts = (state.__lfOpentypeAttempts ?? 0) + 1;
      state.__lfOpentypeAttempts = attempts;
      if (attempts === 1) throw new Error('chunk failed');
      return {
        parse: () => ({
          getAdvanceWidth: () => 0,
          getPath: () => ({ commands: [] }),
        }),
      };
    });
    try {
      const fresh = await import('./text-to-polylines');
      const input = {
        fontBuffer: new ArrayBuffer(0),
        content: '',
        sizeMm: 10,
        alignment: 'left' as const,
        lineHeight: 1.4,
        color: '#000000',
      };

      await expect(fresh.textToPolylines(input)).rejects.toThrow(/chunk failed|mocking a module/);
      await expect(fresh.textToPolylines(input)).resolves.toMatchObject({
        bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      });
    } finally {
      vi.doUnmock('opentype.js');
      vi.resetModules();
      delete (globalThis as { __lfOpentypeAttempts?: number }).__lfOpentypeAttempts;
    }
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
