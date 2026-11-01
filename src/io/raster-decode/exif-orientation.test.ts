// The Orientation rules measured in Chrome 152 (see exif-orientation.ts), one
// case each: each expectation is what Chromium did with the same bytes.

import { describe, expect, it } from 'vitest';
import {
  exifBlockOrientation,
  orientationSourcePixel,
  pngExifOrientation,
  type ExifOrientation,
} from './exif-orientation';
import {
  exifChunk,
  exifTiffBlock,
  pngChunk,
  syntheticPngBytes,
  type ExifBlockOptions,
} from './exif-orientation.test-support';

const ALL: ReadonlyArray<ExifOrientation> = [1, 2, 3, 4, 5, 6, 7, 8];

function blockOrientation(options: ExifBlockOptions): ExifOrientation | null {
  const bytes = Uint8Array.from(exifTiffBlock(options));
  return exifBlockOrientation(bytes, 0, bytes.byteLength);
}

describe('exifBlockOrientation', () => {
  it.each(ALL)('reads IFD0 Orientation %i in both byte orders', (value) => {
    expect(blockOrientation({ byteOrder: 'II', ifd0: [{ value }] })).toBe(value);
    expect(blockOrientation({ byteOrder: 'MM', ifd0: [{ value }] })).toBe(value);
  });

  it.each([
    ['value 0', { value: 0 }],
    ['value 9', { value: 9 }],
    ['count 2', { value: 6, count: 2 }],
    ['type LONG', { value: 6, type: 4 }],
  ] as const)('skips an IFD0 Orientation with %s', (_name, entry) => {
    expect(blockOrientation({ ifd0: [entry] })).toBeNull();
  });

  it('takes the first valid IFD0 Orientation, skipping an invalid one before it', () => {
    expect(blockOrientation({ ifd0: [{ value: 0 }, { value: 6 }] })).toBe(6);
    expect(blockOrientation({ ifd0: [{ value: 6 }, { value: 3 }] })).toBe(6);
  });

  it('reads the Exif sub-IFD when IFD0 holds no valid Orientation', () => {
    expect(blockOrientation({ subIfd: [{ value: 6 }] })).toBe(6);
    expect(blockOrientation({ ifd0: [{ value: 9 }], subIfd: [{ value: 6 }] })).toBe(6);
    expect(blockOrientation({ ifd0: [{ value: 6, count: 2 }], subIfd: [{ value: 8 }] })).toBe(8);
    // A valid IFD0 Orientation decides, even 1.
    expect(blockOrientation({ ifd0: [{ value: 1 }], subIfd: [{ value: 6 }] })).toBe(1);
  });

  it('rejects a block without a TIFF header', () => {
    const block = exifTiffBlock({ ifd0: [{ value: 6 }] });
    const badMagic = Uint8Array.from(block);
    badMagic[3] = 43;
    expect(exifBlockOrientation(badMagic, 0, badMagic.byteLength)).toBeNull();
    // A JPEG-style "Exif\0\0" prefix is not a TIFF header.
    const prefixed = Uint8Array.from([0x45, 0x78, 0x69, 0x66, 0, 0, ...block]);
    expect(exifBlockOrientation(prefixed, 0, prefixed.byteLength)).toBeNull();
    expect(exifBlockOrientation(prefixed, 6, prefixed.byteLength)).toBe(6);
  });

  it('stops at an entry that runs past the block', () => {
    const block = Uint8Array.from(exifTiffBlock({ ifd0: [{ value: 6 }] }));
    // Header 8 + count 2 + Make 12: the Orientation entry ends 12 bytes later.
    expect(exifBlockOrientation(block, 0, 8 + 2 + 12 + 11)).toBeNull();
    expect(exifBlockOrientation(block, 0, 8 + 2 + 12 + 12)).toBe(6);
  });
});

describe('pngExifOrientation', () => {
  const png = (before: number[][], after: number[][] = []) =>
    syntheticPngBytes({ width: 40, height: 20, beforeIdat: before, afterIdat: after });

  it.each(ALL)('reads Orientation %i from an eXIf before IDAT', (value) => {
    expect(pngExifOrientation(png([exifChunk(value, value % 2 === 0 ? 'II' : 'MM')]))).toBe(value);
  });

  it('reads no Orientation from an eXIf after IDAT, or from none', () => {
    expect(pngExifOrientation(png([], [exifChunk(6)]))).toBe(1);
    expect(pngExifOrientation(png([]))).toBe(1);
  });

  it('lets the first good eXIf decide, even when it records no Orientation', () => {
    const makeOnly = pngChunk({ type: 'eXIf', data: exifTiffBlock({}) });
    expect(pngExifOrientation(png([makeOnly, exifChunk(6)]))).toBe(1);
    expect(pngExifOrientation(png([exifChunk(1), exifChunk(6)]))).toBe(1);
    expect(pngExifOrientation(png([exifChunk(6), exifChunk(1)]))).toBe(6);
  });

  it('skips an eXIf whose CRC does not match', () => {
    const broken = pngChunk({ type: 'eXIf', data: exifTiffBlock({ ifd0: [{ value: 6 }] }) }, true);
    expect(pngExifOrientation(png([broken]))).toBe(1);
    expect(pngExifOrientation(png([broken, exifChunk(8)]))).toBe(8);
  });

  it('ignores an eXIf with a JPEG-style Exif prefix', () => {
    const data = [0x45, 0x78, 0x69, 0x66, 0, 0, ...exifTiffBlock({ ifd0: [{ value: 6 }] })];
    expect(pngExifOrientation(png([pngChunk({ type: 'eXIf', data })]))).toBe(1);
  });

  it('reads an eXIf behind a large chunk, and asks for more bytes when cut short', () => {
    const text = pngChunk({ type: 'tEXt', data: new Array<number>(100_000).fill(65) });
    const bytes = png([text, exifChunk(6)]);
    expect(pngExifOrientation(bytes)).toBe(6);
    expect(pngExifOrientation(bytes.subarray(0, 64 * 1024))).toBeNull();
  });

  it('reads anything that is not a PNG as unturned', () => {
    expect(pngExifOrientation(Uint8Array.of(0xff, 0xd8, 0xff, 0xe1))).toBe(1);
  });
});

describe('orientationSourcePixel', () => {
  // A 3 x 2 stored image; where its stored top-left pixel (0, 0) is displayed.
  it.each([
    [1, [0, 0]],
    [2, [2, 0]],
    [3, [2, 1]],
    [4, [0, 1]],
    [5, [0, 0]],
    [6, [1, 0]],
    [7, [1, 2]],
    [8, [0, 2]],
  ] as const)('Orientation %i shows the stored top-left at %o', (orientation, at) => {
    const [x, y] = at;
    expect(orientationSourcePixel(orientation, x, y, 3, 2)).toEqual([0, 0]);
  });
});
