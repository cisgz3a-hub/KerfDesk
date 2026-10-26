import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import type { TextStyle } from '../scene/text-settings';
import type { Vec2 } from '../scene';
import { bendTextUndistorted, styleTextRender } from './text-style';
import { parseOutlineFont, textToPolylines, type TextRenderResult } from './text-to-polylines';
import type { TextShaping } from './text-shaping-types';

const bytes = readFileSync('src/ui/text/fonts/Roboto-Regular.ttf');
const fontBuffer = bytes.buffer.slice(
  bytes.byteOffset,
  bytes.byteOffset + bytes.byteLength,
) as ArrayBuffer;
const shared = { content: 'AV iO\nTo AV', sizeMm: 20, lineHeight: 1.4, color: '#000000' };

function points(rendered: TextRenderResult): ReadonlyArray<ReadonlyArray<Vec2>> {
  return rendered.paths[0]!.polylines.map((line) => line.points);
}

function expectRigidGlyphs(before: TextRenderResult) {
  const ownership = before.glyphContours![0]!;
  expect(ownership).toHaveLength(before.paths[0]!.polylines.length);
  const bent = bendTextUndistorted(before, 120);
  const source = points(before);
  const target = points(bent);
  expect(target).toHaveLength(source.length);
  for (const glyph of new Set(ownership)) {
    const contours = ownership.flatMap((owner, index) => (owner === glyph ? [index] : []));
    const from = contours.flatMap((index) => source[index]!);
    const to = contours.flatMap((index) => target[index]!);
    expect(to).toHaveLength(from.length);
    from.forEach((point, index) => {
      expect(Math.hypot(to[index]!.x - to[0]!.x, to[index]!.y - to[0]!.y)).toBeCloseTo(
        Math.hypot(point.x - from[0]!.x, point.y - from[0]!.y),
        7,
      );
    });
  }
}

it.each(['left', 'center', 'right'] as const)(
  'preserves spaces, lines, holes and dots with %s alignment',
  async (alignment) => {
    const rendered = await textToPolylines({ ...shared, fontBuffer, alignment });
    expect(new Set(rendered.glyphContours![0]).size).toBe(8);
    for (const style of [
      undefined,
      { bold: true },
      { italic: true },
      { maxWidthMm: 30 },
      { bold: true, italic: true, maxWidthMm: 30 },
    ] satisfies (TextStyle | undefined)[]) {
      const styled = styleTextRender(rendered, style, shared.sizeMm);
      expect(new Set(styled.glyphContours![0]).size).toBe(8);
      expectRigidGlyphs(styled);
    }
  },
);

it('preserves native stroke glyph ownership through all styles and text-box alignment', async () => {
  const rendered = await textToPolylines({
    ...shared,
    geometry: 'single-line',
    fontKey: 'relief-single-line',
    alignment: 'right',
    textBox: { mode: 'fixed', widthMm: 70, heightMm: 60, wrap: true, fit: 'shrink', minSizeMm: 5 },
  });
  expect(new Set(rendered.glyphContours![0]).size).toBe(8);
  const styled = styleTextRender(
    rendered,
    { bold: true, italic: true, maxWidthMm: 30 },
    shared.sizeMm,
  );
  expect(styled.paths[0]!.curves).toHaveLength(rendered.paths[0]!.curves!.length);
  expectRigidGlyphs(styled);
});

it('keeps combining shaping glyphs together while separating overlapping neighbouring clusters', async () => {
  const font = await parseOutlineFont(fontBuffer);
  const content = 'A\u0301V';
  const shaping: TextShaping = {
    content,
    fontBuffer,
    line: () => ({
      glyphs: [
        { id: font.charToGlyphIndex('A'), cluster: 0, x: 0, y: 0, trackingIndex: 0 },
        { id: font.charToGlyphIndex('\u0301'), cluster: 0, x: 0, y: 0, trackingIndex: 0 },
        { id: font.charToGlyphIndex('V'), cluster: 2, x: 1100, y: 0, trackingIndex: 1 },
      ],
      advance: 2400,
      trackingGaps: 1,
    }),
    breakUnits: (text) => Array.from(text),
  };
  const rendered = await textToPolylines({
    ...shared,
    content,
    fontBuffer,
    shaping,
    alignment: 'left',
  });
  expect(new Set(rendered.glyphContours![0]).size).toBe(2);
  expectRigidGlyphs(rendered);
});
