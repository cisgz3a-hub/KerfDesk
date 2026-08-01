import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { rectSelection } from '../image-select/marquee';
import { cloneStrokeDirtyRect, cloneStrokeInPlace } from './clone-stroke';

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? -1;
}

// Source with a grey-40 block at (10..13, 10..13).
function sourceWithBlock() {
  const source = createRgbaBuffer(32, 32);
  for (let y = 10; y < 14; y += 1) {
    for (let x = 10; x < 14; x += 1) {
      const base = (y * 32 + x) * 4;
      source.data[base] = 40;
      source.data[base + 1] = 40;
      source.data[base + 2] = 40;
    }
  }
  return source;
}

const HARD: { diameterPx: number; hardness: number; opacity: number } = {
  diameterPx: 8,
  hardness: 1,
  opacity: 1,
};

describe('cloneStrokeInPlace', () => {
  it('copies the offset source block through a hard tip', () => {
    const doc = createRgbaBuffer(32, 32);
    const source = sourceWithBlock();
    // Painting at (24, 24) with offset (-12, -12) reads source (12, 12).
    cloneStrokeInPlace(
      doc,
      source,
      { x: -12, y: -12 },
      {
        ...HARD,
        points: [{ x: 24, y: 24 }],
      },
    );
    expect(grey(doc, 24, 24)).toBe(40); // block pixel copied
    expect(grey(doc, 28, 28)).toBe(255); // outside the tip untouched
  });

  it('skips taps whose source falls outside the snapshot', () => {
    const doc = createRgbaBuffer(16, 16);
    const source = createRgbaBuffer(16, 16);
    cloneStrokeInPlace(doc, source, { x: -100, y: 0 }, { ...HARD, points: [{ x: 8, y: 8 }] });
    expect(grey(doc, 8, 8)).toBe(255); // nothing copied, nothing corrupted
  });

  it('clamps to a selection clip', () => {
    const doc = createRgbaBuffer(32, 32);
    const source = sourceWithBlock();
    const clip = rectSelection(32, 32, { x: 0, y: 0, width: 25, height: 32 });
    cloneStrokeInPlace(
      doc,
      source,
      { x: -14, y: -14 },
      { ...HARD, points: [{ x: 26, y: 26 }] },
      clip,
    );
    // (26, 26) is outside the clip → untouched even though the tip covers it.
    expect(grey(doc, 26, 26)).toBe(255);
    expect(grey(doc, 24, 26)).toBe(40); // inside the clip: copied from (10, 12)
  });

  it('dirty rect covers the stroke inflated by the radius, clamped', () => {
    const doc = createRgbaBuffer(20, 20);
    const rect = cloneStrokeDirtyRect(
      {
        ...HARD,
        points: [
          { x: 2, y: 2 },
          { x: 18, y: 2 },
        ],
      },
      doc,
    );
    expect(rect.x).toBe(0);
    expect(rect.width).toBe(20);
    expect(rect.y).toBe(0);
    expect(rect.height).toBeGreaterThanOrEqual(7);
  });
});
