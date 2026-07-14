import { beforeEach, describe, expect, it, vi } from 'vitest';

const imageLoader = vi.hoisted(() => ({
  extractLumaBase64: vi.fn(() => 'luma'),
  loadImageAsRawData: vi.fn(),
  readFileAsDataUrl: vi.fn(async () => 'data:image/png;base64,source'),
  readImageNaturalSize: vi.fn(),
}));

vi.mock('../trace/image-loader', () => ({
  burnDecodeMaxEdge: vi.fn(() => 8192),
  ...imageLoader,
}));
vi.mock('../common/image-density', () => ({ readImageDensity: vi.fn(async () => null) }));

import { importImageFile } from './import-image-action';

describe('raster-image import resolution', () => {
  beforeEach(() => vi.clearAllMocks());

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
});
