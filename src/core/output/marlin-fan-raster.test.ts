import { expect, it, vi } from 'vitest';
import type { RasterGroup } from '../job';
import { marlinFanRasterJob } from './marlin-fan-raster';

it('converts provider rows lazily in the requested source order without mutation', () => {
  const values = new Uint16Array([0, 250, 1000]);
  const rowProvider = vi.fn((_y: number) => values);
  const group: RasterGroup = {
    kind: 'raster',
    layerId: 'image',
    color: '#808080',
    power: 100,
    speed: 1500,
    passes: 2,
    airAssist: false,
    sValues: new Uint16Array(),
    rowProvider,
    rowProviderOrder: 'descending-y',
    pixelWidth: 3,
    pixelHeight: 2,
    bounds: { minX: 10, minY: 10, maxX: 13, maxY: 12 },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
  };
  const adapted = marlinFanRasterJob({ groups: [group] }, 1000).groups[0];
  expect(rowProvider).not.toHaveBeenCalled();
  expect(adapted?.kind).toBe('raster');
  if (adapted?.kind !== 'raster') return;
  expect(adapted.rowProviderOrder).toBe('descending-y');
  for (const y of [0, 1, 0, 1]) {
    expect(Array.from(adapted.rowProvider?.(y) ?? [])).toEqual([0, 64, 255]);
  }
  expect(rowProvider.mock.calls).toEqual([[0], [1], [0], [1]]);
  expect(Array.from(values)).toEqual([0, 250, 1000]);
});
