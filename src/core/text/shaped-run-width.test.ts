// Perf audit S1, S7-P3-1: shrink-to-fit lays a frame out up to 20 times and
// wrapping measures every growing prefix of every line. Each distinct line
// string is shaped once per layout, and its width is the very same number
// forEachGlyph gives.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createShapingCache, shapedRunAdvance } from './shaped-run-width';
import { outlineTextToPolylines, parseOutlineFont } from './text-to-polylines';

const SHAPING = { kerning: true, features: { liga: true, rlig: true } } as const;
const WORDS = 'the quick brown fox jumps over lazy dog laser engraves wooden coaster ffi fl'.split(
  ' ',
);

function fontBuffer(file: string): ArrayBuffer {
  const bytes = readFileSync(resolve('src/ui/text/fonts', file));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function paragraph(characters: number): string {
  let text = '';
  for (let index = 0; text.length < characters; index += 1) {
    text += `${WORDS[(index * 7) % WORDS.length] ?? 'word'} `;
  }
  return text.trim();
}

describe('shaped line widths (perf audit S7-P3-1)', () => {
  it('equal forEachGlyph to the bit, for a static and a variable font', async () => {
    for (const file of ['Roboto-Regular.ttf', 'DancingScript-Regular.ttf']) {
      const font = await parseOutlineFont(fontBuffer(file));
      const cache = createShapingCache();
      for (const text of ['', 'A', 'Wave AV To', 'office floor', paragraph(120)]) {
        for (const size of [2, 7.31, 10]) {
          let glyphs = 0;
          const advance = font.forEachGlyph(text, 0, 0, size, SHAPING, () => {
            glyphs += 1;
          });
          expect(shapedRunAdvance(font, text, size, SHAPING, cache)).toEqual({ advance, glyphs });
        }
      }
    }
  });

  it('shapes each line string once while a 200-character frame shrinks to fit', async () => {
    const buffer = fontBuffer('Roboto-Regular.ttf');
    const font = await parseOutlineFont(buffer);
    const shaped = vi.spyOn(font, 'stringToGlyphs');
    const result = outlineTextToPolylines(
      {
        content: paragraph(200),
        sizeMm: 10,
        alignment: 'left',
        lineHeight: 1.4,
        letterSpacing: 0,
        color: '#000000',
        fontBuffer: buffer,
        textBox: {
          mode: 'fixed',
          widthMm: 60,
          heightMm: 30,
          wrap: true,
          fit: 'shrink',
          minSizeMm: 2,
        },
      },
      font,
    );
    expect(result.textBoxLayout?.overflow).toBe(false);
    // Laying the frame out at every bisection size measured about 3,000
    // strings; there are a few hundred distinct ones, plus the drawing.
    expect(shaped.mock.calls.length).toBeLessThan(800);
  });
});
