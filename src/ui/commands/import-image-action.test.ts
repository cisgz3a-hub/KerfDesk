import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageLoader = vi.hoisted(() => ({
  extractLumaBase64: vi.fn(() => 'luma'),
  loadImageAsRawData: vi.fn(),
  readFileAsDataUrl: vi.fn(async () => 'data:image/png;base64,source'),
  readImageNaturalSize: vi.fn(),
}));
const pngImport = vi.hoisted(() => ({
  isPngCandidate: vi.fn(() => true),
  shouldPageBackPng: vi.fn(() => true),
  tryDecodeDimensionQualifiedPng: vi.fn(),
  tryDecodeQualifiedPng: vi.fn(),
}));
const imageDensity = vi.hoisted(() => ({
  readImageDensity: vi.fn(async () => null),
}));

vi.mock('../trace/image-loader', () => ({
  burnDecodeMaxEdge: vi.fn(() => 8192),
  ...imageLoader,
}));
vi.mock('../common/image-density', () => imageDensity);
vi.mock('../import/qualified-png-raster', () => pngImport);

import { importImageFile } from './import-image-action';

describe('raster-image import resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    pngImport.isPngCandidate.mockReturnValue(true);
    pngImport.shouldPageBackPng.mockReturnValue(true);
    pngImport.tryDecodeDimensionQualifiedPng.mockResolvedValue(null);
    pngImport.tryDecodeQualifiedPng.mockResolvedValue(null);
  });

  it('embeds a sub-threshold PNG so the saved project stays self-contained', async () => {
    // Below the page-backing point the raster must carry its own bytes: a
    // page-backed object stores only IndexedDB ids and will not reopen elsewhere.
    pngImport.shouldPageBackPng.mockReturnValue(false);
    imageLoader.readImageNaturalSize.mockResolvedValue({ width: 64, height: 32 });
    imageLoader.loadImageAsRawData.mockResolvedValue({
      width: 64,
      height: 32,
      data: new Uint8ClampedArray(4),
    });
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    await importImageFile(
      new File(['png'], 'logo.png', { type: 'image/png' }),
      importRasterImage,
      pushToast,
    );

    expect(pngImport.tryDecodeQualifiedPng).not.toHaveBeenCalled();
    const imported = importRasterImage.mock.calls[0]?.[0];
    expect(imported).toMatchObject({
      dataUrl: 'data:image/png;base64,source',
      lumaBase64: 'luma',
    });
    expect(imported).not.toHaveProperty('imageAsset');
    // No worker-progress toast belongs on an import that never reaches the worker.
    expect(pushToast).not.toHaveBeenCalledWith(expect.stringContaining('worker'), 'info');
  });

  it('keeps a compressed oversize-edge PNG embedded after incremental worker sampling', async () => {
    pngImport.shouldPageBackPng.mockReturnValue(false);
    pngImport.tryDecodeDimensionQualifiedPng.mockResolvedValue({
      natural: { width: 20_000, height: 1 },
      sampled: { width: 8192, height: 1 },
      density: null,
      lumaBase64: 'sampled-luma',
      cleanupWarning: null,
    });
    const importRasterImage = vi.fn();

    await importImageFile(
      new File(['compressed'], 'panorama.png', { type: 'image/png' }),
      importRasterImage,
      vi.fn(),
    );

    expect(imageLoader.readImageNaturalSize).not.toHaveBeenCalled();
    expect(imageLoader.loadImageAsRawData).not.toHaveBeenCalled();
    expect(importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        dataUrl: 'data:image/png;base64,source',
        lumaBase64: 'sampled-luma',
        pixelWidth: 8192,
        pixelHeight: 1,
      }),
    );
    expect(importRasterImage.mock.calls[0]?.[0]).not.toHaveProperty('imageAsset');
  });

  it('uses the burn decode cap instead of silently sampling through the trace-preview cap', async () => {
    imageLoader.readImageNaturalSize.mockResolvedValue({ width: 6000, height: 3000 });
    imageLoader.loadImageAsRawData.mockResolvedValue({
      width: 6000,
      height: 3000,
      data: new Uint8ClampedArray(4),
    });
    const importRasterImage = vi.fn();

    await importImageFile(
      new File(['x'], 'photo.png', { type: 'image/png' }),
      importRasterImage,
      vi.fn(),
    );

    expect(imageLoader.loadImageAsRawData).toHaveBeenCalledWith(expect.any(File), 8192);
    expect(importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({ pixelWidth: 6000, pixelHeight: 3000 }),
    );
  });

  it('keeps qualified PNG bytes page-backed and retains only a bounded display thumbnail', async () => {
    const rollback = vi.fn(async () => null);
    pngImport.tryDecodeQualifiedPng.mockImplementation(async (_file, options) => {
      options.onProgress({ phase: 'decoding', encodedBytes: 1024, queuePosition: 0 });
      return {
        natural: { width: 9000, height: 4500 },
        sampled: { width: 4000, height: 2000 },
        density: { xDpi: 300, yDpi: 150 },
        imageAsset: {
          schemaVersion: 1,
          repository: 'curvedesk-import-assets-v1',
          sourceAssetId: 'source-pages',
          lumaAssetId: 'luma-pages',
          sourceMimeType: 'image/png',
          sourceByteLength: 123_456_789,
          lumaByteLength: 8_000_000,
          naturalWidth: 9000,
          naturalHeight: 4500,
          sampledWidth: 4000,
          sampledHeight: 2000,
          thumbnail: {
            mimeType: 'image/bmp',
            dataUrl: 'data:image/bmp;base64,thumbnail',
            width: 256,
            height: 128,
          },
        },
        rollback,
      };
    });
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    await importImageFile(
      new File(['png'], 'large.png', { type: 'image/png' }),
      importRasterImage,
      pushToast,
    );

    expect(imageLoader.readImageNaturalSize).not.toHaveBeenCalled();
    expect(imageLoader.loadImageAsRawData).not.toHaveBeenCalled();
    expect(imageLoader.readFileAsDataUrl).not.toHaveBeenCalled();
    expect(imageDensity.readImageDensity).not.toHaveBeenCalled();
    expect(importRasterImage).toHaveBeenCalledWith(
      expect.objectContaining({
        pixelWidth: 4000,
        pixelHeight: 2000,
        imageAsset: expect.objectContaining({
          sourceAssetId: 'source-pages',
          lumaAssetId: 'luma-pages',
          thumbnail: expect.objectContaining({ dataUrl: 'data:image/bmp;base64,thumbnail' }),
        }),
      }),
    );
    expect(importRasterImage.mock.calls[0]?.[0]).not.toHaveProperty('dataUrl');
    expect(importRasterImage.mock.calls[0]?.[0]).not.toHaveProperty('lumaBase64');
    expect(rollback).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith(
      'large.png: decoding and sampling in worker. Press Esc to cancel.',
      'info',
    );
  });

  it('rolls back qualified PNG pages when scene insertion fails', async () => {
    const rollback = vi.fn(async () => null);
    pngImport.tryDecodeQualifiedPng.mockResolvedValue({
      natural: { width: 2, height: 1 },
      sampled: { width: 2, height: 1 },
      density: null,
      imageAsset: {
        schemaVersion: 1,
        repository: 'curvedesk-import-assets-v1',
        sourceAssetId: 'source-pages',
        lumaAssetId: 'luma-pages',
        sourceMimeType: 'image/png',
        sourceByteLength: 100,
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
      },
      rollback,
    });
    const pushToast = vi.fn();

    await expect(
      importImageFile(
        new File(['png'], 'large.png', { type: 'image/png' }),
        () => {
          throw new Error('scene mutation failed');
        },
        pushToast,
      ),
    ).resolves.toBeNull();

    expect(rollback).toHaveBeenCalledOnce();
    expect(pushToast).toHaveBeenCalledWith('Could not load image: scene mutation failed', 'error');
  });

  it('cancels the production PNG request on Escape without falling back or mutating the scene', async () => {
    pngImport.tryDecodeQualifiedPng.mockImplementation(
      async (_file, options) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener(
            'abort',
            () => {
              const error = new Error('cancelled');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        }),
    );
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    const pending = importImageFile(
      new File(['png'], 'large.png', { type: 'image/png' }),
      importRasterImage,
      pushToast,
    );
    await vi.waitFor(() => expect(pngImport.tryDecodeQualifiedPng).toHaveBeenCalledOnce());
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    await expect(pending).resolves.toBeNull();
    expect(imageLoader.readImageNaturalSize).not.toHaveBeenCalled();
    expect(imageLoader.loadImageAsRawData).not.toHaveBeenCalled();
    expect(importRasterImage).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('large.png: import cancelled.', 'info');
  });

  it('fails closed when qualified PNG infrastructure errors after staging starts', async () => {
    pngImport.tryDecodeQualifiedPng.mockRejectedValue(new Error('IndexedDB write failed'));
    const importRasterImage = vi.fn();
    const pushToast = vi.fn();

    await expect(
      importImageFile(
        new File(['png'], 'large.png', { type: 'image/png' }),
        importRasterImage,
        pushToast,
      ),
    ).resolves.toBeNull();

    expect(imageLoader.readImageNaturalSize).not.toHaveBeenCalled();
    expect(imageLoader.loadImageAsRawData).not.toHaveBeenCalled();
    expect(importRasterImage).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledWith('Could not load image: IndexedDB write failed', 'error');
  });
});
