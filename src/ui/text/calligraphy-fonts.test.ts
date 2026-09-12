import { readFileSync } from 'node:fs';
import { parse } from 'opentype.js';
import { describe, expect, it } from 'vitest';
import { flattenColoredPathCurves, type Polyline, type Vec2 } from '../../core/scene';
import { textToPolylines, type TextRenderResult } from '../../core/text';
import { weldTextRender } from '../../core/text/text-weld';

const FILES = [
  'GreatVibes-Regular.ttf',
  'Allura-Regular.ttf',
  'AlexBrush-Regular.ttf',
  'Parisienne-Regular.ttf',
  'PinyonScript-Regular.ttf',
  'Italianno-Regular.ttf',
  'Corinthia-Regular.ttf',
  'CinzelDecorative-Regular.ttf',
] as const;

const SAMPLE = 'Élodie & André · Zoë';

function contours(rendered: TextRenderResult): ReadonlyArray<Polyline> {
  return rendered.paths.flatMap((path) => {
    const flattened = flattenColoredPathCurves(path, { toleranceMm: 0.001 });
    if (flattened.kind !== 'ok') throw new Error('Could not flatten the font outlines.');
    return flattened.polylines;
  });
}

// Independent non-zero winding probe compares the ink region before/after
// welding, including empty counters. It does not call the polygon union code.
function windingAt(point: Vec2, polylines: ReadonlyArray<Polyline>): number {
  let winding = 0;
  for (const polyline of polylines) {
    for (let index = 0; index < polyline.points.length; index += 1) {
      const from = polyline.points[index];
      const to = polyline.points[(index + 1) % polyline.points.length];
      if (from === undefined || to === undefined) continue;
      const cross = (to.x - from.x) * (point.y - from.y) - (point.x - from.x) * (to.y - from.y);
      if (from.y <= point.y && to.y > point.y && cross > 0) winding += 1;
      if (from.y > point.y && to.y <= point.y && cross < 0) winding -= 1;
    }
  }
  return winding;
}

describe('bundled calligraphy collection', () => {
  it.each(FILES)('%s renders accented names and welds their actual outlines', async (file) => {
    const bytes = readFileSync(`src/ui/text/fonts/${file}`);
    const fontBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const font = parse(fontBuffer);
    for (const character of new Set(SAMPLE.replaceAll(' ', ''))) {
      expect(font.charToGlyphIndex(character), `${file} is missing ${character}`).toBeGreaterThan(
        0,
      );
    }
    const source = await textToPolylines({
      content: SAMPLE,
      fontBuffer,
      sizeMm: 24,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color: '#111111',
    });
    const result = weldTextRender(source);
    if (result.kind !== 'ok') throw new Error(result.error.message);
    const before = contours(source);
    const after = contours(result.value);
    expect(after.length).toBeGreaterThan(0);
    expect(after.every((line) => line.closed)).toBe(true);
    expect(
      after
        .flatMap((line) => line.points)
        .every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
    ).toBe(true);
    expect(source.bounds.maxX - source.bounds.minX).toBeGreaterThan(10);
    expect(source.bounds.maxY - source.bounds.minY).toBeGreaterThan(5);
    let inkSamples = 0;
    for (let y = 0; y < 40; y += 1) {
      for (let x = 0; x < 56; x += 1) {
        const point = {
          x: source.bounds.minX + ((x + 0.31) / 56) * (source.bounds.maxX - source.bounds.minX),
          y: source.bounds.minY + ((y + 0.47) / 40) * (source.bounds.maxY - source.bounds.minY),
        };
        const rawWinding = windingAt(point, before);
        const weldedWinding = windingAt(point, after);
        expect(weldedWinding !== 0).toBe(rawWinding !== 0);
        expect(Math.abs(weldedWinding)).toBeLessThanOrEqual(1);
        if (rawWinding !== 0) inkSamples += 1;
      }
    }
    expect(inkSamples).toBeGreaterThan(20);
  });
});
