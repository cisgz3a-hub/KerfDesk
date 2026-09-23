import { describe, expect, it } from 'vitest';
import { tiffDocument } from '../../__fixtures__/tiff-document';
import { decodeTiffPage } from './tiff-page';
import { tiffPageCount } from './tiff-structure';

describe('TIFF pages at their encoded pixel grid', () => {
  it.each([
    [1, [0, 50, 100, 150, 200, 250]],
    [2, [50, 0, 150, 100, 250, 200]],
    [3, [250, 200, 150, 100, 50, 0]],
    [4, [200, 250, 100, 150, 0, 50]],
    [5, [0, 100, 200, 50, 150, 250]],
    [6, [200, 100, 0, 250, 150, 50]],
    [7, [250, 150, 50, 200, 100, 0]],
    [8, [50, 150, 250, 0, 100, 200]],
  ] as const)('orients page %i and swaps independent density axes', (orientation, expected) => {
    const bytes = tiffDocument([{ orientation }]);
    const original = bytes.slice();
    expect(tiffPageCount(bytes)).toBe(1);
    const page = decodeTiffPage(bytes, 1);
    expect(Array.from(page.rgba).filter((_, index) => index % 4 === 0)).toEqual(expected);
    expect([page.width, page.height]).toEqual(orientation >= 5 ? [3, 2] : [2, 3]);
    expect(page.widthMm).toBeCloseTo(orientation >= 5 ? (3 * 25.4) / 200 : (2 * 25.4) / 100);
    expect(page.heightMm).toBeCloseTo(orientation >= 5 ? (2 * 25.4) / 100 : (3 * 25.4) / 200);
    expect(bytes).toEqual(original);
  });

  it.each([true, false])('selects the requested page in either byte order (%s)', (little) => {
    const bytes = tiffDocument([{}, { width: 1, height: 1, pixels: [77] }], little);
    expect(tiffPageCount(bytes)).toBe(2);
    expect(decodeTiffPage(bytes, 2).rgba).toEqual(new Uint8ClampedArray([77, 77, 77, 255]));
  });

  it('normalizes 16-bit WhiteIsZero once and honours transparency over white', () => {
    const whiteZero = decodeTiffPage(
      tiffDocument([{ width: 2, height: 1, bits: 16, type: 0, pixels: [0, 65535] }]),
      1,
    );
    expect(Array.from(whiteZero.rgba)).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    const alpha = decodeTiffPage(
      tiffDocument([
        {
          width: 2,
          height: 1,
          type: 2,
          components: 4,
          alpha: 2,
          pixels: [0, 0, 0, 0, 255, 0, 0, 128],
        },
      ]),
      1,
    );
    expect(Array.from(alpha.rgba)).toEqual([255, 255, 255, 255, 255, 127, 127, 255]);
  });

  it('uses default density only when embedded density is absent or unusable', () => {
    const page = decodeTiffPage(tiffDocument([{ xDpi: 0, yDpi: 0 }]), 1);
    expect(page.densitySource).toBe('default');
    expect(page.widthMm).toBeCloseTo(0.2);
    expect(page.heightMm).toBeCloseTo(0.3);
  });

  it.each([1, 8, 16])(
    'rejects %i-bit float samples that the decoder would read as integers',
    (bits) => {
      const bytes = tiffDocument([{ width: 1, height: 1, bits, sampleFormat: 3, pixels: [1] }]);
      expect(() => decodeTiffPage(bytes, 1)).toThrow(/bit depth for this sample format/);
    },
  );

  it('rejects mixed channel sample formats instead of using only the first channel format', () => {
    const bytes = tiffDocument([
      { width: 1, height: 1, type: 2, components: 3, sampleFormat: [1, 3, 1], pixels: [1, 2, 3] },
    ]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/matching sample formats/);
  });

  it('rejects bilevel premultiplied alpha before the decoder alters packed samples', () => {
    const bytes = tiffDocument([
      { width: 1, height: 1, bits: 1, components: 2, alpha: 1, pixels: [64] },
    ]);
    expect(() => decodeTiffPage(bytes, 1)).toThrow(/premultiplied bilevel/);
  });

  it('reports unsupported compression and malformed directory chains instead of partial artwork', () => {
    expect(() => decodeTiffPage(tiffDocument([{ compression: 32773 }]), 1)).toThrow(/PackBits/);
    const bytes = tiffDocument([{}]);
    const view = new DataView(bytes.buffer);
    const next = 8 + 2 + view.getUint16(8, true) * 12;
    view.setUint32(next, 8, true);
    expect(() => tiffPageCount(bytes)).toThrow(/cyclic/);
    expect(() => tiffPageCount(bytes.subarray(0, 20))).toThrow(/Incomplete/);
  });
});
