import { describe, expect, it } from 'vitest';
import { rasterImportGeometry } from './image-import';

describe('rasterImportGeometry', () => {
  it('uses natural image dimensions for physical size and sampled dimensions for luma', () => {
    const geometry = rasterImportGeometry({
      naturalWidth: 4000,
      naturalHeight: 2000,
      sampledWidth: 1024,
      sampledHeight: 512,
      dpi: 96,
    });
    expect(geometry.bounds).toEqual({
      minX: 0,
      minY: 0,
      maxX: (4000 / 96) * 25.4,
      maxY: (2000 / 96) * 25.4,
    });
    expect(geometry.pixelWidth).toBe(1024);
    expect(geometry.pixelHeight).toBe(512);
  });
});
