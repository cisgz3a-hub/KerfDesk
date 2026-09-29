import { describe, expect, it } from 'vitest';
import { embeddedBitmapSize } from './svg-embedded-bitmap-size';

const dataUrl = (type: string, bytes: readonly number[]) =>
  `data:image/${type};base64,${Buffer.from(bytes).toString('base64')}`;
const be = (value: number, length: number) =>
  Array.from({ length }, (_, index) => (value >>> (8 * (length - 1 - index))) & 0xff);
const le = (value: number, length: number) => be(value, length).reverse();
const ascii = (text: string) => [...text].map((character) => character.charCodeAt(0));

const png = (width: number, height: number) => [
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  ...be(13, 4),
  ...ascii('IHDR'),
  ...be(width, 4),
  ...be(height, 4),
  8,
  6,
  0,
  0,
  0,
  ...be(0, 4),
];

const segment = (marker: number, payload: readonly number[]) => [
  0xff,
  marker,
  ...be(payload.length + 2, 2),
  ...payload,
];
const exif = (orientation: number, order: 'II' | 'MM' = 'MM') => {
  const n = order === 'II' ? le : be;
  return segment(0xe1, [
    ...ascii('Exif'),
    0,
    0,
    ...ascii(order),
    ...n(42, 2),
    ...n(8, 4),
    ...n(1, 2),
    ...n(0x0112, 2),
    ...n(3, 2),
    ...n(1, 4),
    ...n(orientation, 2),
    0,
    0,
    ...n(0, 4),
  ]);
};
const sof = (width: number, height: number) =>
  segment(0xc0, [8, ...be(height, 2), ...be(width, 2), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
const jpeg = (...segments: number[][]) => [0xff, 0xd8, ...segments.flat(), 0xff, 0xd9];

describe('embeddedBitmapSize', () => {
  it('reads a PNG header', () => {
    expect(embeddedBitmapSize(dataUrl('png', png(640, 480)))).toEqual({ width: 640, height: 480 });
  });

  it('reads the JPEG frame size, turned by an EXIF quarter-turn orientation', () => {
    expect(embeddedBitmapSize(dataUrl('jpeg', jpeg(sof(300, 200))))).toEqual({
      width: 300,
      height: 200,
    });
    expect(embeddedBitmapSize(dataUrl('jpeg', jpeg(exif(6), sof(300, 200))))).toEqual({
      width: 200,
      height: 300,
    });
    expect(embeddedBitmapSize(dataUrl('jpeg', jpeg(exif(8, 'II'), sof(300, 200))))).toEqual({
      width: 200,
      height: 300,
    });
    expect(embeddedBitmapSize(dataUrl('jpeg', jpeg(exif(3), sof(300, 200))))).toEqual({
      width: 300,
      height: 200,
    });
  });

  it('reads past large metadata segments to the JPEG frame header', () => {
    const icc = segment(0xe2, new Array<number>(65_000).fill(7));
    const bytes = jpeg(
      segment(0xe1, ascii('http://ns.adobe.com/xap/1.0/')),
      exif(6),
      icc,
      icc,
      sof(40, 30),
    );
    expect(embeddedBitmapSize(dataUrl('jpeg', bytes))).toEqual({ width: 30, height: 40 });
  });

  it('ignores the XML whitespace an exporter wraps the payload in', () => {
    const payload = Buffer.from(png(3, 5))
      .toString('base64')
      .replace(/(.{8})/g, '$1\n  ');
    const wrapped = `data:image/png;base64,${payload}`;
    expect(embeddedBitmapSize(wrapped)).toEqual({ width: 3, height: 5 });
  });

  it('reads BMP headers, including top-down rows', () => {
    const bmp = (width: number, height: number) => [
      ...ascii('BM'),
      ...le(0, 4),
      0,
      0,
      0,
      0,
      ...le(54, 4),
      ...le(40, 4),
      ...le(width, 4),
      ...le(height >>> 0, 4),
      ...le(1, 2),
      ...le(24, 2),
    ];
    expect(embeddedBitmapSize(dataUrl('bmp', bmp(12, 7)))).toEqual({ width: 12, height: 7 });
    expect(embeddedBitmapSize(dataUrl('bmp', bmp(12, -7)))).toEqual({ width: 12, height: 7 });
  });

  it('reads the three WebP bitstream headers', () => {
    const riff = (chunk: string, body: readonly number[]) => [
      ...ascii('RIFF'),
      ...le(4 + 8 + body.length, 4),
      ...ascii('WEBP'),
      ...ascii(chunk),
      ...le(body.length, 4),
      ...body,
    ];
    const lossy = riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le(33, 2), ...le(17, 2)]);
    const lossless = riff('VP8L', [0x2f, ...le((33 - 1) | ((17 - 1) << 14), 4), 0, 0, 0, 0, 0]);
    const extended = riff('VP8X', [0, 0, 0, 0, ...le(33 - 1, 3), ...le(17 - 1, 3)]);
    for (const bytes of [lossy, lossless, extended]) {
      expect(embeddedBitmapSize(dataUrl('webp', bytes))).toEqual({ width: 33, height: 17 });
    }
  });

  it('sniffs the format from the bytes rather than the declared type', () => {
    expect(embeddedBitmapSize(dataUrl('jpeg', png(9, 4)))).toEqual({ width: 9, height: 4 });
  });

  it.each([
    ['a truncated JPEG', dataUrl('jpeg', [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 1, 2])],
    ['a JPEG scan before any frame header', dataUrl('jpeg', jpeg(segment(0xda, [0, 0])))],
    ['a zero-sized PNG', dataUrl('png', png(0, 10))],
    ['unrecognised bytes', dataUrl('png', ascii('GIF89a\u0001\u0000\u0001\u0000'))],
    ['malformed base64', 'data:image/png;base64,iVBO=Rw0KGgo'],
    ['a non-base64 data URL', 'data:image/png,raw'],
  ])('returns null for %s', (_label, url) => {
    expect(embeddedBitmapSize(url)).toBeNull();
  });
});
