import { describe, expect, it, vi } from 'vitest';
import { emitRasterGroup } from '../raster/emit-raster';
import type { Job, RasterGroup } from './job';
import { rasterRowsInProviderOrder } from './raster-rows';
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

  it('maps raster rows onto descending Y when the rotary axis is reversed', () => {
    const result: Job = applyRotaryYScale({ groups: [rasterGroup()] }, 2, true);
    const group = result.groups[0];
    expect(group?.kind).toBe('raster');
    if (group?.kind !== 'raster') throw new Error('raster missing');
    expect(group.bounds).toEqual({ minX: 5, minY: 0, maxX: 15, maxY: 20 });
    expect(Array.from(group.sValues)).toEqual([1, 2, 3, 4]);
    expect(group.rowProviderOrder).toBe('descending-y');
    expect([...rasterRowsInProviderOrder(group)].map(({ rowIndex }) => rowIndex)).toEqual([1, 0]);
  });

  it('keeps a streamed provider forward-only while mapping rows onto descending Y', () => {
    const rows = [Uint16Array.from([1, 2]), Uint16Array.from([3, 4]), Uint16Array.from([5, 6])];
    const rowProvider = vi.fn((row: number) => rows[row] ?? new Uint16Array(0));
    const source: RasterGroup = {
      ...rasterGroup(),
      sValues: new Uint16Array(0),
      rowProvider,
      pixelHeight: 3,
      bounds: { minX: 5, minY: 10, maxX: 15, maxY: 25 },
    };

    const result = applyRotaryYScale({ groups: [source] }, 1, true);
    const group = result.groups[0];
    if (group?.kind !== 'raster') throw new Error('raster missing');
    const emitted = [...rasterRowsInProviderOrder(group)];

    expect(group.rowProvider).toBe(rowProvider);
    expect(group.rowProviderOrder).toBe('descending-y');
    expect(rowProvider.mock.calls.map(([row]) => row)).toEqual([0, 1, 2]);
    expect(emitted.map(({ rowIndex }) => rowIndex)).toEqual([2, 1, 0]);
    expect(emitted.map(({ row }) => Array.from(row))).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
    ]);
  });

  it('maps equivalent materialized and streamed rows onto the same reversed coordinates', () => {
    const rows = [Uint16Array.from([1, 2]), Uint16Array.from([3, 4])];
    const materialized = applyRotaryYScale({ groups: [rasterGroup()] }, 1, true).groups[0];
    const streamed = applyRotaryYScale(
      {
        groups: [
          {
            ...rasterGroup(),
            sValues: new Uint16Array(0),
            rowProvider: (row) => rows[row] ?? new Uint16Array(0),
          },
        ],
      },
      1,
      true,
    ).groups[0];
    if (materialized?.kind !== 'raster' || streamed?.kind !== 'raster') {
      throw new Error('raster missing');
    }

    const entries = (group: RasterGroup) =>
      [...rasterRowsInProviderOrder(group)].map(({ rowIndex, row }) => ({
        rowIndex,
        row: Array.from(row),
      }));

    expect(entries(materialized)).toEqual(entries(streamed));
    expect(emittedGcode(materialized)).toBe(emittedGcode(streamed));
  });
});

function emittedGcode(group: RasterGroup): string {
  return emitRasterGroup({
    sValues: group.sValues,
    ...(group.rowProvider === undefined ? {} : { rowProvider: group.rowProvider }),
    ...(group.rowProviderOrder === undefined ? {} : { rowProviderOrder: group.rowProviderOrder }),
    width: group.pixelWidth,
    height: group.pixelHeight,
    bounds: group.bounds,
    feedMmPerMin: group.speed,
    passes: group.passes,
    overscanMm: group.overscanMm,
    dotWidthCorrectionMm: group.dotWidthCorrectionMm,
  });
}
