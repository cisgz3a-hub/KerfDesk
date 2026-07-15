import { describe, expect, it } from 'vitest';
import type { RasterGroup } from './job';
import { rasterRow } from './raster-rows';

describe('materialized raster rows', () => {
  it('returns a zero-copy view of the compiled pixel buffer', () => {
    const sValues = new Uint16Array([1, 2, 3, 4]);
    const group: RasterGroup = {
      kind: 'raster',
      layerId: 'image',
      color: '#000000',
      power: 50,
      speed: 1_000,
      passes: 1,
      airAssist: false,
      sValues,
      pixelWidth: 2,
      pixelHeight: 2,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };

    const row = rasterRow(group, 1);
    expect(Array.from(row)).toEqual([3, 4]);
    expect(row.buffer).toBe(sValues.buffer);
  });
});
