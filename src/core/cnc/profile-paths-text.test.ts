// Regression: profiling real TEXT geometry crashed clipper2
// ("Scaled coordinate exceeds Number.MAX_SAFE_INTEGER in scalePath64")
// when the CNC pipeline offset glyph contours. Found live in the browser —
// glyph outlines exercise the offsetter differently than synthetic squares.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { textToPolylines } from '../text';
import { pocketToolpathRings } from './pocket-paths';
import { profileToolpathPolylines } from './profile-paths';

const robotoBuffer = readFontBuffer('Roboto-Regular.ttf');

function readFontBuffer(fileName: string): ArrayBuffer {
  const bytes = readFileSync(resolve(__dirname, '../../ui/text/fonts', fileName));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function glyphPolylines(content: string) {
  const rendered = await textToPolylines({
    fontBuffer: robotoBuffer,
    content,
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.4,
    color: '#000000',
  });
  const polylines = rendered.paths[0]?.polylines ?? [];
  expect(polylines.length).toBeGreaterThan(0);
  return polylines;
}

describe('CNC toolpaths on real text geometry', () => {
  it('outside-profiles glyph contours without crashing, all coordinates finite', async () => {
    const out = profileToolpathPolylines(await glyphPolylines('CNC'), 'outside', 3.175);
    expect(out.length).toBeGreaterThan(0);
    for (const polyline of out) {
      for (const p of polyline.points) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it('inside-profiles and pockets glyph contours without crashing', async () => {
    const polylines = await glyphPolylines('OQ8');
    expect(() => profileToolpathPolylines(polylines, 'inside', 1)).not.toThrow();
    expect(() => pocketToolpathRings(polylines, 1, 40)).not.toThrow();
  });

  it('drops polylines carrying non-finite coordinates instead of crashing clipper', () => {
    const poisoned = {
      closed: true,
      points: [
        { x: 0, y: 0 },
        { x: Number.NaN, y: 10 },
        { x: 10, y: 10 },
        { x: 10, y: 0 },
      ],
    };
    const good = {
      closed: true,
      points: [
        { x: 20, y: 20 },
        { x: 40, y: 20 },
        { x: 40, y: 40 },
        { x: 20, y: 40 },
      ],
    };
    const profiled = profileToolpathPolylines([poisoned, good], 'outside', 2);
    expect(profiled).toHaveLength(1);
    const pocketed = pocketToolpathRings([poisoned, good], 2, 40);
    expect(pocketed.length).toBeGreaterThan(0);
    for (const ring of pocketed) {
      for (const p of ring.points) {
        expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      }
    }
  });
});
