import { beforeEach, describe, expect, it, vi } from 'vitest';

const worker = vi.hoisted(() => ({
  importPngOffThread: vi.fn(),
}));
const repository = vi.hoisted(() => ({
  abort: vi.fn(async () => undefined),
  readManifest: vi.fn(),
  readAssetChunks: vi.fn(),
}));

vi.mock('./png-import-worker-client', () => worker);
vi.mock('./paged-asset-indexeddb', () => ({
  IndexedDbPagedAssetRepository: class {
    abort = repository.abort;
    readManifest = repository.readManifest;
    readAssetChunks = repository.readAssetChunks;
  },
}));
vi.mock('../raster/luma-bitmap', () => ({ lumaToBase64: vi.fn(() => 'luma') }));

import {
  PAGED_PNG_MIN_BYTES,
  shouldPageBackPng,
  tryDecodeDimensionQualifiedPng,
  tryDecodeQualifiedPng,
} from './qualified-png-raster';

/** A PNG reporting `bytes` without allocating them. */
function pngFileOfSize(bytes: number, name = 'source.png'): File {
  const file = new File(['png'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

const largePng = (name = 'source.png'): File => pngFileOfSize(PAGED_PNG_MIN_BYTES + 1, name);

function compressedPngHeader(width: number, height: number): File {
  return new File(
    [
      Uint8Array.of(
        0x89,
        0x50,
        0x4e,
        0x47,
        0x0d,
        0x0a,
        0x1a,
        0x0a,
        0x00,
        0x00,
        0x00,
        0x0d,
        0x49,
        0x48,
        0x44,
        0x52,
        (width >>> 24) & 0xff,
        (width >>> 16) & 0xff,
        (width >>> 8) & 0xff,
        width & 0xff,
        (height >>> 24) & 0xff,
        (height >>> 16) & 0xff,
        (height >>> 8) & 0xff,
        height & 0xff,
        0x08,
        0x02,
        0x00,
        0x00,
        0x00,
      ),
    ],
    'compressed.png',
    { type: 'image/png' },
  );
}

describe('page-backing threshold', () => {
  it('leaves a PNG at or below the threshold on the portable embedded path', async () => {
    // A page-backed `.lf2` stores only IndexedDB ids, so it does not open on
    // another machine. Small PNGs must keep their bytes in the file.
    expect(shouldPageBackPng(pngFileOfSize(PAGED_PNG_MIN_BYTES))).toBe(false);
    expect(shouldPageBackPng(pngFileOfSize(64 * 1024))).toBe(false);

    await expect(tryDecodeQualifiedPng(pngFileOfSize(64 * 1024))).resolves.toBeNull();
    expect(worker.importPngOffThread).not.toHaveBeenCalled();
  });

  it('pages back a PNG above the threshold', () => {
    expect(shouldPageBackPng(largePng())).toBe(true);
  });

  it('never pages back a non-PNG regardless of size', () => {
    const jpg = new File(['jpg'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(jpg, 'size', { value: PAGED_PNG_MIN_BYTES * 4 });

    expect(shouldPageBackPng(jpg)).toBe(false);
  });
});

describe('tryDecodeQualifiedPng', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('incrementally samples an oversize-edge compressed PNG but returns portable embedded luma', async () => {
    const file = compressedPngHeader(20_000, 1);
    expect(shouldPageBackPng(file)).toBe(false);
    repository.readAssetChunks.mockReturnValue(
      (async function* () {
        yield Uint8Array.of(0, 127, 255);
      })(),
    );
    worker.importPngOffThread.mockResolvedValue({
      kind: 'ok',
      width: 20_000,
      height: 1,
      sampledWidth: 3,
      sampledHeight: 1,
      density: null,
      sourceManifest: { assetId: 'source-pages', mimeType: 'image/png', byteLength: file.size },
      lumaManifest: { assetId: 'luma-pages', byteLength: 3 },
      thumbnail: {
        mimeType: 'image/bmp',
        width: 3,
        height: 1,
        bytes: Uint8Array.of(0x42, 0x4d),
      },
    });

    await expect(tryDecodeDimensionQualifiedPng(file)).resolves.toMatchObject({
      natural: { width: 20_000, height: 1 },
      sampled: { width: 3, height: 1 },
      lumaBase64: 'AH//',
      cleanupWarning: null,
    });
    expect(worker.importPngOffThread).toHaveBeenCalledOnce();
    expect(repository.abort).toHaveBeenCalledTimes(2);
  });

  it('leaves an embedded-safe compressed PNG on the ordinary portable route', async () => {
    await expect(tryDecodeDimensionQualifiedPng(compressedPngHeader(640, 480))).resolves.toBeNull();
    expect(worker.importPngOffThread).not.toHaveBeenCalled();
  });

  it('fails closed after worker or staging infrastructure errors', async () => {
    worker.importPngOffThread.mockRejectedValue(new Error('IndexedDB write failed'));

    await expect(tryDecodeQualifiedPng(largePng())).rejects.toThrow('IndexedDB write failed');
    expect(repository.abort).toHaveBeenCalledTimes(2);
  });

  it('retains explicit legacy fallback for an unqualified PNG variant', async () => {
    worker.importPngOffThread.mockResolvedValue({
      kind: 'legacy-fallback',
      reason: 'interlaced PNG is not yet qualified',
    });

    await expect(tryDecodeQualifiedPng(largePng())).resolves.toBeNull();
  });

  it('returns page references and a bounded thumbnail without reading whole luma into UI memory', async () => {
    worker.importPngOffThread.mockResolvedValue({
      kind: 'ok',
      width: 9000,
      height: 4500,
      sampledWidth: 4000,
      sampledHeight: 2000,
      sourceManifest: {
        assetId: 'source-pages',
        mimeType: 'image/png',
        byteLength: 300_000_000,
      },
      lumaManifest: {
        assetId: 'luma-pages',
        byteLength: 8_000_000,
      },
      thumbnail: {
        mimeType: 'image/bmp',
        width: 256,
        height: 128,
        bytes: Uint8Array.of(0x42, 0x4d),
      },
    });

    const result = await tryDecodeQualifiedPng(largePng());

    expect(result?.imageAsset).toMatchObject({
      sourceAssetId: 'source-pages',
      lumaAssetId: 'luma-pages',
      sourceByteLength: 300_000_000,
      lumaByteLength: 8_000_000,
      thumbnail: {
        mimeType: 'image/bmp',
        width: 256,
        height: 128,
        dataUrl: 'data:image/bmp;base64,Qk0=',
      },
    });
    expect(repository.readManifest).not.toHaveBeenCalled();
    expect(repository.readAssetChunks).not.toHaveBeenCalled();
    await result?.rollback();
    expect(repository.abort).toHaveBeenCalledTimes(2);
  });
});
