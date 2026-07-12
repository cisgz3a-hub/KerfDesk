import { describe, expect, it } from 'vitest';
import type { Job, RasterGroup } from './job';
import { applyRotaryYScale } from './rotary-transform';

function rasterGroup(): RasterGroup {
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#808080',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist: false,
    sValues: Uint16Array.from([1, 2, 3, 4]),
    pixelWidth: 2,
    pixelHeight: 2,
    bounds: { minX: 5, minY: 10, maxX: 15, maxY: 20 },
    overscanMm: 5,
    dotWidthCorrectionMm: 0,
  };
}

describe('applyRotaryYScale raster', () => {
  it('rebases and scales raster Y bounds without changing row data', () => {
    const result = applyRotaryYScale({ groups: [rasterGroup()] }, 2);
    const group = result.groups[0];
    expect(group?.kind).toBe('raster');
    if (group?.kind !== 'raster') throw new Error('raster missing');
    expect(group.bounds).toEqual({ minX: 5, minY: 0, maxX: 15, maxY: 20 });
    expect(Array.from(group.sValues)).toEqual([1, 2, 3, 4]);
  });

  it('reverses raster rows when the rotary axis is reversed', () => {
    const result: Job = applyRotaryYScale({ groups: [rasterGroup()] }, 2, true);
    const group = result.groups[0];
    expect(group?.kind).toBe('raster');
    if (group?.kind !== 'raster') throw new Error('raster missing');
    expect(group.bounds).toEqual({ minX: 5, minY: 0, maxX: 15, maxY: 20 });
    expect(Array.from(group.sValues)).toEqual([3, 4, 1, 2]);
  });
});
