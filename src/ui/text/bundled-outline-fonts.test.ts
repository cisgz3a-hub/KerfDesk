// Proves every bundled outline .ttf is a real, renderable font.
//
// The failure this exists for is documented in .gitattributes: a Dancing
// Script download was once an HTML error page committed under a .ttf name,
// CRLF-normalized into corruption, and only discovered when it failed to
// parse. The registry test pins the catalog entry, which a corrupt binary
// still satisfies. This one renders the actual bytes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FONT_REGISTRY, textToPolylines } from '../../core/text';

const SAMPLE = 'Your Text Here';
const SIZE_MM = 20;
// 12 glyphs + the 4 counters in "o" and the three "e" of the sample string.
const SAMPLE_LOOPS = 16;
const FONT_DIR = 'src/ui/text/fonts';
const FILE_BY_KEY: Readonly<Record<string, string>> = {
  'roboto-regular': 'Roboto-Regular.ttf',
  'poppins-regular': 'Poppins-Regular.ttf',
  'tinos-regular': 'Tinos-Regular.ttf',
  'tinos-bold': 'Tinos-Bold.ttf',
  'inconsolata-regular': 'Inconsolata-Regular.ttf',
  'courier-prime-regular': 'CourierPrime-Regular.ttf',
  'pacifico-regular': 'Pacifico-Regular.ttf',
  'dancing-script-regular': 'DancingScript-Regular.ttf',
  'anton-regular': 'Anton-Regular.ttf',
  'special-elite-regular': 'SpecialElite-Regular.ttf',
  'unifraktur-maguntia-book': 'UnifrakturMaguntia-Book.ttf',
  'stardos-stencil-regular': 'StardosStencil-Regular.ttf',
  'saira-stencil-one-regular': 'SairaStencilOne-Regular.ttf',
};

function fontBuffer(file: string): ArrayBuffer {
  const buf = readFileSync(`${FONT_DIR}/${file}`);
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

const outlineFonts = FONT_REGISTRY.filter((entry) => entry.geometry === 'outline');

describe('bundled outline fonts', () => {
  it('has a checked-in file for every registered outline font', () => {
    expect(outlineFonts.map((entry) => entry.key).sort()).toEqual(Object.keys(FILE_BY_KEY).sort());
  });

  for (const entry of outlineFonts) {
    it(`renders ${entry.displayName} to finite closed geometry`, async () => {
      const file = FILE_BY_KEY[entry.key];
      expect(file).toBeDefined();
      const rendered = await textToPolylines({
        content: SAMPLE,
        sizeMm: SIZE_MM,
        alignment: 'left',
        lineHeight: 1.4,
        letterSpacing: 0,
        color: '#000000',
        fontBuffer: fontBuffer(file ?? ''),
      });
      const polylines = rendered.paths[0]?.polylines ?? [];
      expect(polylines.length).toBeGreaterThan(0);
      expect(polylines.every((line) => line.closed)).toBe(true);
      const points = polylines.flatMap((line) => line.points);
      expect(points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
      // Geometry must occupy real space — a font that parses but renders
      // nothing would otherwise pass every assertion above.
      expect(rendered.bounds.maxX).toBeGreaterThan(0);
      expect(rendered.bounds.maxY).toBeGreaterThan(0);
    });
  }

  // Tinos is metrically compatible with Times New Roman (ADR-266), so its
  // measure is narrower than Roboto's for the same string at the same size.
  it('renders Tinos with the expected loop count, narrower than Roboto', async () => {
    const shared = {
      content: SAMPLE,
      sizeMm: SIZE_MM,
      alignment: 'left',
      lineHeight: 1.4,
      letterSpacing: 0,
      color: '#000000',
    } as const;
    const tinos = await textToPolylines({ ...shared, fontBuffer: fontBuffer('Tinos-Regular.ttf') });
    const roboto = await textToPolylines({
      ...shared,
      fontBuffer: fontBuffer('Roboto-Regular.ttf'),
    });
    expect(tinos.paths[0]?.polylines.length).toBe(SAMPLE_LOOPS);
    expect(tinos.bounds.maxX).toBeLessThan(roboto.bounds.maxX);
  });
});
