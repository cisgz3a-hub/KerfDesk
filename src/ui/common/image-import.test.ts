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

  it('falls back to the default DPI for a non-positive or non-finite dpi (no Infinity/NaN bounds)', () => {
    // Defense in depth against a poison density (0 px/m, NaN, Infinity): the
    // bounds must stay finite so the import cannot NaN-poison saves/autosave.
    const fallback = (4000 / 96) * 25.4;
    for (const dpi of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const geometry = rasterImportGeometry({
        naturalWidth: 4000,
        naturalHeight: 2000,
        sampledWidth: 1024,
        sampledHeight: 512,
        dpi,
      });
      expect(Number.isFinite(geometry.bounds.maxX)).toBe(true);
      expect(geometry.bounds.maxX).toBeCloseTo(fallback, 6);
    }
  });
});
