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
  tryDecodeQualifiedPng,
} from './qualified-png-raster';

/** A PNG reporting `bytes` without allocating them. */
function pngFileOfSize(bytes: number, name = 'source.png'): File {
  const file = new File(['png'], name, { type: 'image/png' });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

const largePng = (name = 'source.png'): File => pngFileOfSize(PAGED_PNG_MIN_BYTES + 1, name);

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
