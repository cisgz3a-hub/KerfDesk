// @vitest-environment node
import { crc32, deflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { tiffDocument } from '../../__fixtures__/tiff-document';
import { decodeRaster, sniffRasterFormat } from './decode-raster';

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(new TextEncoder().encode(type), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

type PngSpec = {
  readonly width: number;
  readonly height: number;
  readonly bitDepth: number;
  readonly colorType: number;
  /** Filtered scanlines (filter byte first), already in pass order. */
  readonly raw: ReadonlyArray<number>;
  readonly interlaced?: boolean;
  readonly extra?: ReadonlyArray<Uint8Array>;
};

function png(spec: PngSpec): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, spec.width);
  view.setUint32(4, spec.height);
  ihdr.set([spec.bitDepth, spec.colorType, 0, 0, spec.interlaced === true ? 1 : 0], 8);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...(spec.extra ?? []),
    chunk('IDAT', deflateSync(Uint8Array.from(spec.raw))),
    chunk('IEND', new Uint8Array()),
  ];
  return Uint8Array.from(parts.flatMap((part) => [...part]));
}

const pixels = (data: Uint8ClampedArray): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < data.length; i += 4) out.push([...data.subarray(i, i + 4)]);
  return out;
};

describe('headless raster decoders (ADR-477)', () => {
  it('decodes 8-bit grey PNG rows through every filter', async () => {
    // Row 0 None, row 1 Sub, row 2 Up, row 3 Average, row 4 Paeth.
    const raw = [0, 10, 20, 1, 30, 5, 2, 1, 1, 3, 10, 10, 4, 0, 0];
    const image = await decodeRaster(png({ width: 2, height: 5, bitDepth: 8, colorType: 0, raw }));
    expect(pixels(image.data).map((p) => p[0])).toEqual([10, 20, 30, 35, 31, 36, 25, 40, 25, 40]);
    expect(pixels(image.data)[0]).toEqual([10, 10, 10, 255]);
  });

  it('decodes palette PNG with tRNS and packed 2-bit indices', async () => {
    const palette = chunk('PLTE', Uint8Array.from([255, 0, 0, 0, 255, 0, 0, 0, 255]));
    const trns = chunk('tRNS', Uint8Array.from([255, 128]));
    const raw = [0, 0b00_01_10_00];
    const image = await decodeRaster(
      png({ width: 3, height: 1, bitDepth: 2, colorType: 3, raw, extra: [palette, trns] }),
    );
    expect(pixels(image.data)).toEqual([
      [255, 0, 0, 255],
      [0, 255, 0, 128],
      [0, 0, 255, 255],
    ]);
  });

  it('decodes 16-bit RGBA and a keyed grey transparency', async () => {
    const rgba = await decodeRaster(
      png({
        width: 1,
        height: 1,
        bitDepth: 16,
        colorType: 6,
        raw: [0, 255, 255, 0, 0, 128, 0, 255, 255],
      }),
    );
    expect(pixels(rgba.data)).toEqual([[255, 0, 128, 255]]);
    const key = chunk('tRNS', Uint8Array.from([0, 7]));
    const grey = await decodeRaster(
      png({ width: 2, height: 1, bitDepth: 8, colorType: 0, raw: [0, 7, 9], extra: [key] }),
    );
    expect(pixels(grey.data)).toEqual([
      [7, 7, 7, 0],
      [9, 9, 9, 255],
    ]);
  });

  it('decodes an Adam7-interlaced PNG', async () => {
    // 3x3 grey: passes 1 (0,0), 4 (2,0), 5 (0,2),(2,2), 6 (1,0),(1,2), 7 row 1.
    const raw = [0, 1, 0, 3, 0, 7, 9, 0, 2, 0, 8, 0, 4, 5, 6];
    const image = await decodeRaster(
      png({ width: 3, height: 3, bitDepth: 8, colorType: 0, raw, interlaced: true }),
    );
    expect(pixels(image.data).map((p) => p[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('decodes bottom-up 24-bit BMP with its density', async () => {
    const bytes = new Uint8Array(54 + 8 * 2);
    const view = new DataView(bytes.buffer);
    bytes.set([0x42, 0x4d]);
    view.setUint32(10, 54, true);
    view.setUint32(14, 40, true);
    view.setInt32(18, 2, true);
    view.setInt32(22, 2, true);
    view.setUint16(28, 24, true);
    view.setInt32(38, 11811, true);
    view.setInt32(42, 11811, true);
    // Bottom row first; each row is BGR BGR + 2 padding bytes.
    bytes.set([255, 0, 0, 0, 255, 0, 0, 0, 0, 0, 255, 255, 255, 255, 0, 0], 54);
    const image = await decodeRaster(bytes);
    expect(pixels(image.data)).toEqual([
      [255, 0, 0, 255],
      [255, 255, 255, 255],
      [0, 0, 255, 255],
      [0, 255, 0, 255],
    ]);
    expect(image.dpi?.x).toBeCloseTo(300, 0);
  });

  it('decodes ASCII and binary Netpbm', async () => {
    const pbm = await decodeRaster(new TextEncoder().encode('P1\n# c\n3 1\n1 0 1\n'));
    expect(pixels(pbm.data).map((p) => p[0])).toEqual([0, 255, 0]);
    const header = new TextEncoder().encode('P5 2 1 100\n');
    const pgm = await decodeRaster(Uint8Array.from([...header, 0, 100]));
    expect(pixels(pgm.data).map((p) => p[0])).toEqual([0, 255]);
  });

  it('decodes a TIFF page and its resolution, and names unknown formats', async () => {
    const bytes = tiffDocument([{ width: 2, height: 1, pixels: [0, 255], xDpi: 200, yDpi: 200 }]);
    expect(sniffRasterFormat(bytes)).toBe('tiff');
    const image = await decodeRaster(bytes);
    expect([image.width, image.height]).toEqual([2, 1]);
    expect(image.dpi?.x).toBeCloseTo(200, 6);
    await expect(decodeRaster(Uint8Array.from([1, 2, 3, 4]))).rejects.toThrow(/Unrecognised/);
    const gif = new TextEncoder().encode('GIF89a\u0001\u0000\u0001\u0000');
    await expect(decodeRaster(gif)).rejects.toThrow(/GIF input is not supported/);
  });
});
