import { describe, expect, it } from 'vitest';
import { describeImportedImageSize, rasterImportGeometry } from './image-import';

describe('describeImportedImageSize', () => {
  it('reports the natural size when the decode was not capped', () => {
    expect(describeImportedImageSize({ width: 400, height: 300 }, { width: 400, height: 300 })).toBe(
      '400x300 px',
    );
  });

  it('reports natural size and appends the working resolution when capped', () => {
    expect(
      describeImportedImageSize({ width: 6000, height: 4000 }, { width: 2048, height: 1365 }),
    ).toBe('6000x4000 px, processed at 2048x1365');
  });
});

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
    // The default is 254 DPI (ADR-048).
    const fallback = (4000 / 254) * 25.4;
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
