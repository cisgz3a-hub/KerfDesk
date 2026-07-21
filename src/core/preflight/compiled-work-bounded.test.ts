import { describe, expect, it } from 'vitest';
import type { RasterGroup } from '../job';
import { runCompiledWorkPreflight } from './compiled-work';

describe('compiled raster work advisory', () => {
  it('stops requesting streamed rows once the advisory threshold is proven', () => {
    const width = 1_000;
    const height = 1_000;
    const alternating = Uint16Array.from({ length: width }, (_, x) => (x % 2 === 0 ? 100 : 0));
    let requestedRows = 0;
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'pathological-raster',
      color: '#000000',
      power: 50,
      speed: 1_000,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array(0),
      rowProvider: () => {
        requestedRows += 1;
        return alternating;
      },
      pixelWidth: width,
      pixelHeight: height,
      bounds: { minX: 0, minY: 0, maxX: width, maxY: height },
      overscanMm: 0,
      dotWidthCorrectionMm: 0,
    };

    const result = runCompiledWorkPreflight({ groups: [raster] });
    expect(result.ok).toBe(false);
    expect(result.issues[0]?.message).toContain('at least');
    expect(requestedRows).toBeLessThan(300);
  });
});
