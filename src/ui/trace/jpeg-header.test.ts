import { describe, expect, it } from 'vitest';
import {
  jpegExifOrientation,
  orientationCanvasTransform,
  orientedDimensions,
  parseJpegHeader,
  type ExifOrientation,
} from './jpeg-header';
import { syntheticJpegBytes } from './jpeg-header.test-support';

const PHONE = { width: 4032, height: 3024 };
const ALL: ReadonlyArray<ExifOrientation> = [1, 2, 3, 4, 5, 6, 7, 8];

describe('parseJpegHeader', () => {
  it.each(ALL)('reads the stored frame and Orientation %i in both byte orders', (orientation) => {
    for (const byteOrder of ['II', 'MM'] as const) {
      expect(parseJpegHeader(syntheticJpegBytes({ ...PHONE, orientation, byteOrder }))).toEqual({
        stored: PHONE,
        orientation,
      });
    }
  });

  it.each([
    { name: 'no EXIF', options: PHONE },
    { name: 'Orientation 0', options: { ...PHONE, orientation: 0 } },
    { name: 'Orientation 9', options: { ...PHONE, orientation: 9 } },
  ])('reads $name as the stored orientation', ({ options }) => {
    expect(parseJpegHeader(syntheticJpegBytes(options))?.orientation).toBe(1);
  });

  it.each([0, 2])(
    'ignores an Orientation entry whose count is %i, like browser decoders',
    (count) => {
      // A malformed entry that a browser decoder ignores must not make the
      // loader ask for a turned size the browser will not produce.
      const bytes = syntheticJpegBytes({ ...PHONE, orientation: 6, orientationCount: count });
      expect(parseJpegHeader(bytes)?.orientation).toBe(1);
      expect(jpegExifOrientation(bytes)).toBe(1);
    },
  );

  it('skips an XMP APP1 before the EXIF APP1', () => {
    const bytes = syntheticJpegBytes({ ...PHONE, orientation: 6, xmpBeforeExif: true });
    expect(parseJpegHeader(bytes)).toEqual({ stored: PHONE, orientation: 6 });
    expect(jpegExifOrientation(bytes)).toBe(6);
  });

  it('keeps the frame size when the EXIF block is cut short', () => {
    const bytes = syntheticJpegBytes({ ...PHONE, orientation: 6 });
    // Corrupt the IFD0 offset so it points past the APP1 segment.
    const tiff = bytes.indexOf(0x49, 4);
    bytes[tiff + 4] = 0xff;
    expect(parseJpegHeader(bytes)).toEqual({ stored: PHONE, orientation: 1 });
  });

  it('rejects a non-JPEG and a JPEG without a frame header', () => {
    expect(parseJpegHeader(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
    expect(parseJpegHeader(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toBeNull();
  });
});

describe('oriented size', () => {
  it.each([
    [1, { width: 4032, height: 3024 }],
    [3, { width: 4032, height: 3024 }],
    [6, { width: 3024, height: 4032 }],
    [8, { width: 3024, height: 4032 }],
  ] as const)('Orientation %i displays a 4032x3024 frame as %o', (orientation, oriented) => {
    expect(orientedDimensions(PHONE, orientation)).toEqual(oriented);
  });
});

describe('orientationCanvasTransform', () => {
  // Where each stored corner must land once the image is displayed upright
  // (EXIF 2.3 Orientation, 0th row / 0th column placement).
  const CANVAS = { width: 30, height: 20 };
  const topLeftLandsAt: Readonly<Record<ExifOrientation, readonly [number, number]>> = {
    1: [0, 0],
    2: [30, 0],
    3: [30, 20],
    4: [0, 20],
    5: [0, 0],
    6: [30, 0],
    7: [30, 20],
    8: [0, 20],
  };

  it.each(ALL)('Orientation %i fills the canvas and puts the stored origin in place', (o) => {
    const [a, b, c, d, e, f] = orientationCanvasTransform(o, CANVAS.width, CANVAS.height);
    const swap = o >= 5;
    const drawn = swap
      ? { width: CANVAS.height, height: CANVAS.width }
      : { width: CANVAS.width, height: CANVAS.height };
    const map = (x: number, y: number): readonly [number, number] => [
      a * x + c * y + e,
      b * x + d * y + f,
    ];
    const corners = [
      map(0, 0),
      map(drawn.width, 0),
      map(0, drawn.height),
      map(drawn.width, drawn.height),
    ];
    expect(corners[0]).toEqual(topLeftLandsAt[o]);
    expect(new Set(corners.map(([x, y]) => `${x + 0},${y + 0}`))).toEqual(
      new Set(['0,0', '30,0', '0,20', '30,20']),
    );
    // The stored first row runs along the displayed top (1-4) or a side (5-8).
    const firstRowEnd = map(drawn.width, 0);
    expect(firstRowEnd[1] === corners[0]![1]).toBe(!swap);
  });
});
