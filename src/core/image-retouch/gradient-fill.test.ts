import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { rectSelection } from '../image-select/marquee';
import { fillGradientInPlace } from './gradient-fill';

const BLACK = { r: 0, g: 0, b: 0 };
const WHITE = { r: 255, g: 255, b: 255 };

function grey(doc: ReturnType<typeof createRgbaBuffer>, x: number, y: number): number {
  return doc.data[(y * doc.width + x) * 4] ?? -1;
}

describe('fillGradientInPlace', () => {
  it('linear ramps fg→bg along the drag with clamped ends', () => {
    const doc = createRgbaBuffer(101, 1);
    fillGradientInPlace(
      doc,
      { from: { x: 0, y: 0 }, to: { x: 100, y: 0 }, shape: 'linear' },
      BLACK,
      WHITE,
    );
    expect(grey(doc, 0, 0)).toBeLessThanOrEqual(2);
    expect(grey(doc, 100, 0)).toBeGreaterThanOrEqual(253);
    const mid = grey(doc, 50, 0);
    expect(mid).toBeGreaterThan(120);
    expect(mid).toBeLessThan(136);
  });

  it('radial ramps out from the origin symmetrically', () => {
    const doc = createRgbaBuffer(41, 41);
    fillGradientInPlace(
      doc,
      { from: { x: 20.5, y: 20.5 }, to: { x: 40.5, y: 20.5 }, shape: 'radial' },
      BLACK,
      WHITE,
    );
    expect(grey(doc, 20, 20)).toBeLessThanOrEqual(6);
    expect(Math.abs(grey(doc, 30, 20) - grey(doc, 10, 20))).toBeLessThanOrEqual(2);
    expect(Math.abs(grey(doc, 20, 30) - grey(doc, 30, 20))).toBeLessThanOrEqual(2);
    expect(grey(doc, 40, 20)).toBeGreaterThanOrEqual(248);
  });

  it('clamps to the selection mask', () => {
    const doc = createRgbaBuffer(10, 10);
    const mask = rectSelection(10, 10, { x: 0, y: 0, width: 5, height: 10 });
    fillGradientInPlace(
      doc,
      { from: { x: 0, y: 0 }, to: { x: 9, y: 0 }, shape: 'linear' },
      BLACK,
      BLACK,
      mask,
    );
    expect(grey(doc, 2, 5)).toBe(0); // inside: solid black
    expect(grey(doc, 7, 5)).toBe(255); // outside untouched
  });

  it('a zero-length drag paints solid foreground', () => {
    const doc = createRgbaBuffer(4, 4);
    fillGradientInPlace(
      doc,
      { from: { x: 2, y: 2 }, to: { x: 2, y: 2 }, shape: 'linear' },
      { r: 40, g: 40, b: 40 },
      WHITE,
    );
    expect(grey(doc, 0, 0)).toBe(40);
    expect(grey(doc, 3, 3)).toBe(40);
  });
});
