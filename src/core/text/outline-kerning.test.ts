import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as hb from 'harfbuzzjs';
import * as opentype from 'opentype.js';
import { createTextShaping } from './text-shaping';
import { textToPolylines, type TextRenderResult } from './text-to-polylines';
import { latinPairKerning } from './outline-kerning';

// Oracle audit O7-P2-1: basic-Latin text is laid out by opentype.js, complex
// text by HarfBuzz. OpenType (ScriptList, LookupList) and HarfBuzz agree on
// how a font kerns Latin; these tests hold the opentype.js route to HarfBuzz.

function bytes(path: string): ArrayBuffer {
  const buffer = readFileSync(resolve(__dirname, path));
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;
}

const input = { sizeMm: 10, alignment: 'left' as const, lineHeight: 1.2, color: '#000000' };

async function bothRoutes(
  content: string,
  fontBuffer: ArrayBuffer,
): Promise<readonly [TextRenderResult, TextRenderResult]> {
  const latin = await textToPolylines({ ...input, content, fontBuffer });
  const shaped = await textToPolylines({
    ...input,
    content,
    fontBuffer,
    shaping: createTextShaping(hb, fontBuffer, content),
  });
  return [latin, shaped];
}

function contourStarts(rendered: TextRenderResult): ReadonlyArray<number> {
  return (rendered.paths[0]?.curves ?? []).flatMap((curve) => [curve.start.x, curve.start.y]);
}

function expectSameLayout(
  [latin, shaped]: readonly [TextRenderResult, TextRenderResult],
  label: string,
): void {
  const a = contourStarts(latin);
  const b = contourStarts(shaped);
  expect(a.length, label).toBe(b.length);
  a.forEach((value, index) => expect(value, `${label} #${index}`).toBeCloseTo(b[index] ?? NaN, 6));
}

describe('basic-Latin kerning follows OpenType (O7-P2-1)', () => {
  it('kerns from the latn script when DFLT has no kern feature (Liberation Sans)', async () => {
    const liberation = bytes('../../ui/import/pdf-fonts/LiberationSans-Regular.ttf');
    const [latin, shaped] = await bothRoutes('AVATAR', liberation);
    // HarfBuzz: 7586 of 2048 units. Without kerning opentype.js drew 8194 (2.97 mm wider).
    expect(latin.bounds.maxX).toBeCloseTo(shaped.bounds.maxX, 6);
    expectSameLayout([latin, shaped], 'Liberation AVATAR');
  });

  it('applies every kern lookup, not only the first that covers the pair (Pinyon Script)', async () => {
    const pinyon = bytes('../../ui/text/fonts/PinyonScript-Regular.ttf');
    const font = opentype.parse(pinyon);
    const space = font.charToGlyphIndex(' ');
    // HarfBuzz kerns space→V by +150 units; the second lookup holds the pair.
    expect(latinPairKerning(font)(space, font.charToGlyphIndex('V'))).toBe(150);
    expectSameLayout(await bothRoutes("P. F, L' V. Yo", pinyon), 'Pinyon');
  });

  it('keeps the legacy kern table for a font without GPOS (Stardos Stencil)', () => {
    const font = opentype.parse(bytes('../../ui/text/fonts/StardosStencil-Regular.ttf'));
    const kern = latinPairKerning(font);
    expect(kern(font.charToGlyphIndex('A'), font.charToGlyphIndex('V'))).toBe(-218);
  });

  it('lays every bundled font out as HarfBuzz does, apart from two known gaps', async () => {
    // Pacifico substitutes contextual alternates ('calt') that opentype.js
    // does not apply; harfbuzzjs is built without the legacy 'kern' table that
    // Stardos Stencil kerns with. Both are listed in the O7 report.
    const known = new Set(['Pacifico-Regular.ttf', 'StardosStencil-Regular.ttf']);
    const directory = resolve(__dirname, '../../ui/text/fonts');
    const fonts = readdirSync(directory).filter(
      (file) => file.endsWith('.ttf') && !known.has(file),
    );
    expect(fonts.length).toBeGreaterThan(15);
    for (const file of fonts) {
      const buffer = bytes(`../../ui/text/fonts/${file}`);
      for (const content of ['AVATAR Wave To', "P. F, L' V. Yo", 'office fi fl ffi']) {
        expectSameLayout(await bothRoutes(content, buffer), `${file} ${content}`);
      }
    }
  }, 60_000);
});
