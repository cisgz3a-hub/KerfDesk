// PNG tRNS for grayscale and truecolour sources (PNG Third Edition 11.3.1.1):
// pixels of exactly the named colour are fully transparent, every other pixel
// is opaque. The streamed luma route paints them as paper, as the browser
// route does for smaller files.
import { describe, expect, it } from 'vitest';
import { decodeIncrementalPngToLuma } from './png-incremental-decoder';
import { chunksOf, makePng, type PngFixtureOptions } from './png-incremental-decoder.test-support';

describe('decodeIncrementalPngToLuma with a tRNS key colour', () => {
  it('paints only exact matches of a truecolour key as paper', async () => {
    const rows = await lumaRows({
      width: 3,
      height: 1,
      colorType: 2,
      // The key, a colour one blue step away from it, and an opaque grey.
      rows: [[0, 0, 0, 0, 0, 1, 200, 200, 200]],
      transparency: Uint8Array.of(0, 0, 0, 0, 0, 0),
    });

    expect(rows).toEqual([[255, 0, 200]]);
  });

  it('paints a grayscale key as paper and leaves other greys alone', async () => {
    const rows = await lumaRows({
      width: 3,
      height: 1,
      colorType: 0,
      rows: [[0, 1, 200]],
      transparency: Uint8Array.of(0, 0),
    });

    expect(rows).toEqual([[255, 1, 200]]);
  });

  it('counts a keyed pixel as paper before sampling down', async () => {
    const rows = await lumaRows(
      {
        width: 2,
        height: 1,
        colorType: 2,
        rows: [[10, 20, 30, 0, 0, 0]],
        transparency: Uint8Array.of(0, 10, 0, 20, 0, 30),
      },
      1,
    );

    // Half paper, half black.
    expect(rows).toEqual([[128]]);
  });

  it('ignores the unused high byte of each 8-bit key sample', async () => {
    const rows = await lumaRows({
      width: 1,
      height: 1,
      colorType: 2,
      rows: [[10, 20, 30]],
      transparency: Uint8Array.of(0xff, 10, 0x01, 20, 0x80, 30),
    });

    expect(rows).toEqual([[255]]);
  });

  it.each([
    {
      label: 'wrong byte length',
      options: { transparency: Uint8Array.of(0, 0) },
      reason: /truecolour tRNS.*exactly 6 bytes/,
    },
    {
      label: 'after IDAT',
      options: { transparency: new Uint8Array(6), transparencyAfterIdat: true },
      reason: /tRNS.*precede IDAT/,
    },
    {
      label: 'duplicate',
      options: { transparency: new Uint8Array(6), duplicateTransparency: true },
      reason: /only one tRNS/,
    },
  ])('rejects truecolour tRNS with $label', async ({ options, reason }) => {
    const png = makePng({ width: 1, height: 1, colorType: 2, rows: [[0, 0, 0]], ...options });

    await expect(
      decodeIncrementalPngToLuma(chunksOf(png, 3), {
        maxEdge: 8,
        maxPixels: 64,
        onRow: () => undefined,
      }),
    ).rejects.toThrow(reason);
  });
});

async function lumaRows(options: PngFixtureOptions, maxEdge = 8): Promise<number[][]> {
  const rows: number[][] = [];
  await decodeIncrementalPngToLuma(chunksOf(makePng(options), 5), {
    maxEdge,
    maxPixels: 64,
    onRow: (row) => {
      rows.push([...row]);
    },
  });
  return rows;
}
