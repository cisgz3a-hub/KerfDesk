import { describe, expect, it } from 'vitest';
import { createRgbaBuffer } from '../image-edit/rgba-buffer';
import { removeWhiteBackgroundInPlace } from './remove-white-background';

function pixels(values: number[]) {
  const doc = createRgbaBuffer(values.length / 4, 1);
  doc.data.set(values);
  return doc;
}

describe('removeWhiteBackgroundInPlace', () => {
  it('removes paper while preserving ink coverage and existing transparency', () => {
    const doc = pixels([255, 255, 255, 255, 179, 179, 179, 255, 0, 0, 0, 255, 153, 153, 153, 128]);
    removeWhiteBackgroundInPlace(doc, 0, null, null);
    expect([...doc.data]).toEqual([255, 255, 255, 0, 0, 0, 0, 76, 0, 0, 0, 255, 0, 0, 0, 51]);
  });

  it('reconstructs coloured source pixels over white within RGBA8 rounding', () => {
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const doc = pixels([r, g, b, 255]);
          removeWhiteBackgroundInPlace(doc, 0, null, null);
          const alpha = doc.data[3]! / 255;
          for (const [channel, original] of [r, g, b].entries()) {
            const composite = doc.data[channel]! * alpha + 255 * (1 - alpha);
            expect(Math.abs(composite - original)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it('clamps to the rectangle and mask, blending soft selections without a fringe', () => {
    const original = [128, 153, 204, 255];
    const doc = pixels([...original, ...original, ...original]);
    removeWhiteBackgroundInPlace(
      doc,
      0,
      { x: 0, y: 0, width: 2, height: 1 },
      {
        width: 3,
        height: 1,
        alpha: new Uint8Array([0, 128, 255]),
      },
    );
    expect([...doc.data.slice(0, 4)]).toEqual(original);
    expect([...doc.data.slice(8, 12)]).toEqual(original);
    const alpha = doc.data[7]! / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      const composite = doc.data[4 + channel]! * alpha + 255 * (1 - alpha);
      expect(Math.abs(composite - original[channel]!)).toBeLessThanOrEqual(1);
    }
  });

  it('lets cleanup remove near-white paper and ignores invisible RGB', () => {
    const doc = pixels([242, 242, 242, 255, 42, 83, 127, 0]);
    removeWhiteBackgroundInPlace(doc, 10, null, null);
    expect([...doc.data]).toEqual([255, 255, 255, 0, 42, 83, 127, 0]);
  });

  it.each([NaN, Infinity, -100])('handles invalid cleanup %s as the default', (cleanup) => {
    const doc = pixels([179, 179, 179, 255]);
    removeWhiteBackgroundInPlace(doc, cleanup, null, null);
    expect([...doc.data]).toEqual([0, 0, 0, 76]);
  });
});
