// Pins the property that justifies the `stencil` style class (ADR-267).
//
// A stencil face is not a look, it is a cutting guarantee: no contour is
// nested inside another, so cutting the outline out of material leaves no
// loose centre pieces. Loop count cannot express this - the stencil faces
// actually have MORE loops than the ordinary ones, because their glyphs are
// split into separate strokes. What matters is nesting, so that is what this
// measures, with ordinary faces as the negative control.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FONT_REGISTRY, textToPolylines } from '../../core/text';
import type { Polyline, Vec2 } from '../../core/scene';

const SAMPLE = 'Your Text Here';
const SIZE_MM = 20;
const FONT_DIR = 'src/ui/text/fonts';
const STENCIL_FILES: Readonly<Record<string, string>> = {
  'stardos-stencil-regular': 'StardosStencil-Regular.ttf',
  'saira-stencil-one-regular': 'SairaStencilOne-Regular.ttf',
};
// Ordinary faces whose counters DO enclose — proves the probe can see nesting.
const CONTROL_FILES: ReadonlyArray<string> = ['Tinos-Regular.ttf', 'Roboto-Regular.ttf'];
// "Your Text Here" encloses exactly four counters in a conventional face:
// the `o` of Your and the three `e`s.
const CONTROL_ENCLOSED = 4;

function fontBuffer(file: string): ArrayBuffer {
  const b = readFileSync(`${FONT_DIR}/${file}`);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
}

function isPointInside(point: Vec2, polygon: ReadonlyArray<Vec2>): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const straddles = a.y > point.y !== b.y > point.y;
    if (straddles && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function enclosedLoopCount(loops: ReadonlyArray<Polyline>): number {
  let count = 0;
  for (let i = 0; i < loops.length; i += 1) {
    const probe = loops[i]?.points[0];
    if (probe === undefined) continue;
    for (let j = 0; j < loops.length; j += 1) {
      const other = loops[j];
      if (i === j || other === undefined) continue;
      if (isPointInside(probe, other.points)) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

async function renderLoops(file: string): Promise<ReadonlyArray<Polyline>> {
  const rendered = await textToPolylines({
    content: SAMPLE,
    sizeMm: SIZE_MM,
    alignment: 'left',
    lineHeight: 1.4,
    letterSpacing: 0,
    color: '#000000',
    fontBuffer: fontBuffer(file),
  });
  return rendered.paths[0]?.polylines ?? [];
}

describe('stencil fonts leave nothing to fall out', () => {
  it('registers a file for every stencil-class font', () => {
    const registered = FONT_REGISTRY.filter((e) => e.styleClass === 'stencil').map((e) => e.key);
    expect(registered.sort()).toEqual(Object.keys(STENCIL_FILES).sort());
  });

  for (const [key, file] of Object.entries(STENCIL_FILES)) {
    it(`${key} encloses no counters`, async () => {
      const loops = await renderLoops(file);
      expect(loops.length).toBeGreaterThan(0);
      expect(enclosedLoopCount(loops)).toBe(0);
    });
  }

  // Negative control: without this, a broken probe that always returns 0
  // would make every assertion above pass vacuously.
  for (const file of CONTROL_FILES) {
    it(`${file} does enclose its counters, proving the check works`, async () => {
      expect(enclosedLoopCount(await renderLoops(file))).toBe(CONTROL_ENCLOSED);
    });
  }
});
