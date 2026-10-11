import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as hb from 'harfbuzzjs';
import * as opentype from 'opentype.js';
import { createTextShaping } from './text-shaping';
import { textToPolylines } from './text-to-polylines';
import { needsTextShaping } from './text-shaping-required';
import { textForLayout } from './glyph-coverage';
import { placeTextOnPath } from './text-on-path';
import { IDENTITY_TRANSFORM, type SceneObject } from '../scene';
import type { TextBoxSettings } from '../scene/text-box';

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(__dirname, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}
const tinos = bytes('../../ui/text/fonts/Tinos-Regular.ttf');
const roboto = bytes('../../ui/text/fonts/Roboto-Regular.ttf');
const arabic = bytes('__fixtures__/NotoSansArabic-Regular.ttf');
const tinosFont = opentype.parse(tinos);
const shape = (content: string, font = tinos) =>
  createTextShaping(hb, font, textForLayout(content));
const visualIds = (text: string) =>
  Array.from(text).map((character) => tinosFont.charToGlyphIndex(character));
const ids = (text: string) =>
  shape(text)
    .line(0, text.length)
    .glyphs.map((glyph) => glyph.id);
const input = { sizeMm: 10, alignment: 'left' as const, lineHeight: 1.4, color: '#000000' };
const render = (
  content: string,
  fontBuffer = tinos,
  overrides: Partial<typeof input & { letterSpacing: number; textBox: TextBoxSettings }> = {},
) =>
  textToPolylines({
    ...input,
    ...overrides,
    content,
    fontBuffer,
    shaping: shape(content, fontBuffer),
  });

describe('multilingual glyph layout', () => {
  it('orders Hebrew and mixed digits by Unicode bidi, not string reversal', () => {
    expect(ids('שלום עולם')).toEqual(visualIds('םלוע םולש'));
    expect(ids('ABC שלום 123')).toEqual(visualIds('ABC 123 םולש'));
    expect(ids('שלום (123)')).toEqual(visualIds('(123) םולש'));
  });

  it('honours an explicit RTL isolate without engraving formatting glyphs', () => {
    expect(ids('ABC \u2067שלום 123\u2069 DEF')).toEqual(visualIds('ABC 123 םולש DEF'));
  });

  it('preserves existing Latin kerning/ligatures and simple Arabic joining', () => {
    const content = 'AVATAR office fi fl';
    const font = opentype.parse(roboto);
    const expected: number[] = [];
    const advance = font.forEachGlyph(
      content,
      0,
      0,
      font.unitsPerEm,
      { kerning: true, features: { liga: true, rlig: true } },
      (glyph) => {
        expected.push(glyph.index);
      },
    );
    const latin = shape(content, roboto).line(0, content.length);
    expect(latin.glyphs.map((glyph) => glyph.id)).toEqual(expected);
    expect(latin.advance).toBe(advance);
    expect(
      shape('سلام', arabic)
        .line(0, 4)
        .glyphs.map((glyph) => glyph.id),
    ).toEqual([770, 705, 1083]);
  });

  it('composes decomposed Latin accents into the expected precomposed outlines', async () => {
    expect(ids('a\u0301 e\u0308 n\u0303')).toEqual(visualIds('á ë ñ'));
    expect((await render('a\u0301 e\u0308 n\u0303')).paths).toEqual((await render('á ë ñ')).paths);
  });

  it('positions Arabic marks with the independently browser-checked font oracle', () => {
    const text = 'السَّلَامُ';
    const line = shape(text, arabic).line(0, text.length);
    // Noto fixture SHA256 ceea25b4...; these positions were checked against
    // native Chrome in the evaluation, not generated from this implementation.
    expect(line.advance).toBe(2431);
    expect(line.glyphs.map(({ id, x, y }) => [id, x, y])).toEqual([
      [236, 89, 76],
      [770, 0, 0],
      [292, 744, -256],
      [705, 484, 0],
      [292, 1332, -74],
      [1163, 1340, 126],
      [1085, 1083, 0],
      [668, 1933, 0],
      [46, 2193, 0],
    ]);
    expect(line.trackingGaps).toBe(4);
  });

  it('keeps supplementary characters whole in bidi and shaping clusters', () => {
    const content = 'ABC שלום \u{1f600} 123';
    const shaped = shape(content).line(0, content.length);
    const surrogateStart = content.indexOf('\u{1f600}');
    expect(shaped.glyphs.some((glyph) => glyph.cluster === surrogateStart)).toBe(true);
    expect(shaped.glyphs.some((glyph) => glyph.cluster === surrogateStart + 1)).toBe(false);
    expect(shape(content).breakUnits(content, 0).join('')).toBe(content);
  });

  it('isolates concurrent owners, fonts and line-cache entries deterministically', () => {
    const first = shape('שלום\nABC שלום 123');
    const before = first.line(0, 4);
    shape('السَّلَامُ', arabic).line(0, 10);
    first.line(5, 17);
    expect(first.line(0, 4)).toEqual(before);
    expect(shape('שלום').line(0, 4)).toEqual(before);
  });
});

describe('multilingual outlines and existing text workflows', () => {
  it('retains ordinary Latin selection and rejects an unprepared/stale complex render', async () => {
    expect(needsTextShaping('AVATAR office Crème ✓')).toBe(false);
    await expect(textToPolylines({ ...input, fontBuffer: tinos, content: 'שלום' })).rejects.toThrow(
      'multilingual text engine',
    );
    await expect(
      textToPolylines({ ...input, fontBuffer: tinos, content: 'שלומ', shaping: shape('שלום') }),
    ).rejects.toThrow('different text or font');
    await expect(
      textToPolylines({ ...input, fontBuffer: roboto, content: 'שלום', shaping: shape('שלום') }),
    ).rejects.toThrow('different text or font');
  });

  it('preserves exact native curves, closed counters and millimetre scaling', async () => {
    const small = await render('ABC שלום 123');
    const large = await render('ABC שלום 123', tinos, { sizeMm: 20 });
    expect(large.bounds.maxX).toBeCloseTo(small.bounds.maxX * 2, 9);
    expect(large.bounds.maxY).toBeCloseTo(small.bounds.maxY * 2, 9);
    expect(small.paths[0]?.curves?.every((curve) => curve.closed)).toBe(true);
    expect(
      small.paths[0]?.curves?.some((curve) =>
        curve.segments.some((segment) => segment.kind === 'cubic'),
      ),
    ).toBe(true);
    expect(small.paths[0]?.curves).toHaveLength(small.paths[0]?.polylines.length ?? 0);
  });

  it('adds tracking between clusters without detaching a combining mark', async () => {
    const natural = await render('a\u0301a\u0301');
    const tracked = await render('a\u0301a\u0301', tinos, { letterSpacing: 0.2 });
    expect(tracked.bounds.maxX - natural.bounds.maxX).toBeCloseTo(2, 9);
    const line = shape('السَّلَامُ', arabic).line(0, 10);
    expect(line.glyphs[0]?.trackingIndex).toBe(line.glyphs[1]?.trackingIndex);
    expect(line.glyphs[2]?.trackingIndex).toBe(line.glyphs[3]?.trackingIndex);
  });

  it('uses hard paragraphs and retains the original paragraph direction through soft wraps', async () => {
    const content = 'שלום ABC DEF GHI';
    const rendered = await render(content, tinos, {
      textBox: {
        mode: 'auto-height',
        widthMm: 25,
        heightMm: 100,
        wrap: true,
        fit: 'none',
        minSizeMm: 1,
      },
    });
    expect(rendered.textBoxLayout?.lineCount).toBeGreaterThan(1);
    const softStart = rendered.textBoxLayout?.sourceStarts?.[1] ?? -1;
    expect(softStart).toBeGreaterThan(0);
    const shaper = shape(content);
    // Both English words are LTR within the RTL paragraph: digits/words must
    // not be re-resolved as an unrelated LTR paragraph after wrapping.
    expect(shaper.line(5, content.length).glyphs.map((glyph) => glyph.id)).toEqual(
      visualIds('ABC DEF GHI'),
    );
    const doubled = await render('שלום\nשלום');
    const one = await render('שלום');
    expect(doubled.bounds.maxY - one.bounds.maxY).toBeCloseTo(14, 9);
  });

  it('wraps between shaping clusters, leaving an oversized cluster visibly overflowing', async () => {
    const content = 'a\u0301a\u0301';
    const rendered = await render(content, tinos, {
      textBox: {
        mode: 'auto-height',
        widthMm: 0.1,
        heightMm: 100,
        wrap: true,
        fit: 'none',
        minSizeMm: 1,
      },
    });
    expect(rendered.textBoxLayout?.content).toBe('a\u0301\na\u0301');
    expect(rendered.textBoxLayout?.sourceStarts).toEqual([0, 2]);
    expect(rendered.textBoxLayout?.overflow).toBe(true);
  });

  it('still reports missing visible glyphs, while bidi controls and joiners are layout', async () => {
    const rendered = await render('שלום \u2067\u0627\u200d\u0627\u2069 \u{1f600}');
    expect(rendered.missingCharacters).toContain('\u0627');
    expect(rendered.missingCharacters).toContain('\u{1f600}');
    expect(rendered.missingCharacters).not.toContain('\u2067');
    expect(rendered.missingCharacters).not.toContain('\u200d');
  });

  it('keeps native stroke fonts on their existing open-path route', async () => {
    const rendered = await textToPolylines({
      ...input,
      geometry: 'single-line',
      fontKey: 'relief-single-line',
      content: 'שלום',
    });
    expect(rendered.missingCharacters).toEqual(['ש', 'ל', 'ו', 'ם']);
    expect(rendered.paths[0]?.curves?.every((curve) => !curve.closed)).toBe(true);
  });

  it('places shaped curves on a guide through the existing path-text contract', async () => {
    const rendered = await render('שלום');
    const guide: SceneObject = {
      kind: 'imported-svg',
      id: 'guide',
      source: 'line.svg',
      transform: IDENTITY_TRANSFORM,
      bounds: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      paths: [
        {
          color: '#000000',
          polylines: [
            {
              closed: false,
              points: [
                { x: 0, y: 0 },
                { x: 100, y: 0 },
              ],
            },
          ],
        },
      ],
    };
    const placed = placeTextOnPath(rendered, guide, {
      guideObjectId: 'guide',
      offsetMm: 0,
      reverse: false,
    });
    expect(placed.kind).toBe('ok');
    if (placed.kind === 'ok') {
      expect(placed.rendered.bounds.maxX).toBeCloseTo(rendered.bounds.maxX, 9);
      expect(placed.rendered.paths[0]?.curves).toHaveLength(rendered.paths[0]?.curves?.length ?? 0);
    }
  });
});
