import { describe, expect, it } from 'vitest';
import { emitRasterGroup } from './emit-raster';

describe('emitRasterGroup feed ceiling', () => {
  it('floors a decimal feed so emitted motion cannot exceed its configured ceiling', () => {
    const output = emitRasterGroup({
      sValues: new Uint16Array([100, 100, 100, 100]),
      width: 2,
      height: 2,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
      feedMmPerMin: 1000.6,
      overscanMm: 0,
      layerId: 'L1',
      color: '#000000',
      powerPercent: 80,
    });
    expect(output).toContain('feed 1000 mm/min');
    expect(output).toMatch(/\bF1000\b/);
    expect(output).not.toMatch(/\bF1001\b/);
  });

  it('preserves a positive sub-1 feed without exceeding its ceiling', () => {
    const output = emitRasterGroup({
      sValues: new Uint16Array([100, 100]),
      width: 2,
      height: 1,
      bounds: { minX: 0, minY: 0, maxX: 2, maxY: 1 },
      feedMmPerMin: 0.75,
      overscanMm: 0,
    });
    expect(output).toContain('feed 0.75 mm/min');
    expect(output).toMatch(/\bF0\.75\b/);
    expect(output).not.toMatch(/\bF1\b/);
  });
});
