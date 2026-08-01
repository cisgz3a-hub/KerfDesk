import { describe, expect, it } from 'vitest';
import { IDENTITY_TRANSFORM, type RasterImage } from '../../core/scene';
import type { PagedRasterAssetReader } from './paged-raster-hydration';
import { readRasterSourceFile } from './paged-raster-source';

const SOURCE_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4]);
const FIRST_CHUNK_END = 5;
const EMBEDDED_DATA_URL = 'data:image/png;base64,QUJD';
const EMBEDDED_BYTE_LENGTH = 3;

const IMAGE_ASSET: NonNullable<RasterImage['imageAsset']> = {
  schemaVersion: 1,
  repository: 'curvedesk-import-assets-v1',
  sourceAssetId: 'source-pages',
  lumaAssetId: 'luma-pages',
  sourceMimeType: 'image/png',
  sourceByteLength: SOURCE_BYTES.byteLength,
  lumaByteLength: 2,
  naturalWidth: 2,
  naturalHeight: 1,
  sampledWidth: 2,
  sampledHeight: 1,
  thumbnail: {
    mimeType: 'image/bmp',
    dataUrl: 'data:image/bmp;base64,thumbnail',
    width: 2,
    height: 1,
  },
};

function readerYielding(bytes: Uint8Array, chunkEnd: number): PagedRasterAssetReader {
  return {
    readManifest: () => Promise.resolve(null),
    // Two chunks that are views over ONE buffer, the way a real paged read
    // hands back slices of a scratch buffer it goes on to reuse.
    readAssetChunks: async function* () {
      yield bytes.subarray(0, chunkEnd);
      yield bytes.subarray(chunkEnd);
    },
  };
}

function pagedRaster(sourceByteLength: number): RasterImage {
  return {
    kind: 'raster-image',
    id: 'paged-image',
    source: 'large.png',
    imageAsset: { ...IMAGE_ASSET, sourceByteLength },
    pixelWidth: 2,
    pixelHeight: 1,
    bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    color: '#111111',
    dither: 'threshold',
    linesPerMm: 1,
  };
}

describe('readRasterSourceFile', () => {
  it('reads a page-backed raster back to its FULL source bytes, not the thumbnail', async () => {
    const image = pagedRaster(SOURCE_BYTES.byteLength);

    const file = await readRasterSourceFile(
      image,
      'large.png',
      readerYielding(SOURCE_BYTES, FIRST_CHUNK_END),
    );

    // (jsdom's File has no arrayBuffer(), so size is the byte-count check
    // available here — the same limitation save-rd-action.test.ts records.)
    expect(file.type).toBe('image/png');
    expect(file.size).toBe(SOURCE_BYTES.byteLength);
    expect(file.name).toBe('large.png');
  });

  it('rejects a short read rather than handing back a truncated image', async () => {
    const image = pagedRaster(SOURCE_BYTES.byteLength + 1);

    await expect(
      readRasterSourceFile(image, 'large.png', readerYielding(SOURCE_BYTES, FIRST_CHUNK_END)),
    ).rejects.toThrow(/manifest expects/);
  });

  it('still reads an embedded raster from its dataUrl', async () => {
    const { imageAsset: _pagedAsset, ...rest } = pagedRaster(0);
    const embedded: RasterImage = { ...rest, source: 'small.png', dataUrl: EMBEDDED_DATA_URL };

    const file = await readRasterSourceFile(embedded, 'small.png');

    expect(file.size).toBe(EMBEDDED_BYTE_LENGTH);
    expect(file.type).toBe('image/png');
  });
});
