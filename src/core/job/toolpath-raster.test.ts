import { describe, expect, it } from 'vitest';
import type { Job, RasterGroup } from './job';
import { buildToolpath, sliceToolpath } from './toolpath';

function rasterGroup(overrides: Partial<RasterGroup> = {}): RasterGroup {
  const pixelWidth = overrides.pixelWidth ?? 1;
  const pixelHeight = overrides.pixelHeight ?? 1;
  return {
    kind: 'raster',
    layerId: 'image',
    color: '#444444',
    power: 30,
    speed: 1000,
    passes: 1,
    airAssist: false,
    sValues: new Uint16Array(pixelWidth * pixelHeight).fill(500),
    pixelWidth,
    pixelHeight,
    bounds: { minX: 0, minY: 0, maxX: pixelWidth, maxY: pixelHeight },
    overscanMm: 0,
    dotWidthCorrectionMm: 0,
    ...overrides,
  };
}

function rasterJob(group: RasterGroup): Job {
  return { groups: [group] };
}

describe('buildToolpath raster preview rows', () => {
  it('renders raster image rows as route preview sweeps with overscan and bidirectional travel', () => {
    const tp = buildToolpath(
      rasterJob(
        rasterGroup({
          sourceObjectId: 'photo-1',
          source: 'photo.png',
          pixelWidth: 4,
          pixelHeight: 2,
          bounds: { minX: 10, minY: 20, maxX: 14, maxY: 22 },
          overscanMm: 1,
          sValues: new Uint16Array([0, 500, 500, 0, 0, 0, 500, 500]),
        }),
      ),
    );
    const cuts = tp.steps.filter((step) => step.kind === 'cut');

    expect(tp.steps.map((step) => step.kind)).toEqual([
      'travel',
      'cut',
      'travel',
      'travel',
      'travel',
      'cut',
      'travel',
    ]);
    expect(tp.steps[0]).toMatchObject({
      kind: 'travel',
      from: { x: 10, y: 20.5 },
      to: { x: 11, y: 20.5 },
    });
    expect(tp.steps[1]).toMatchObject({
      kind: 'cut',
      color: '#444444',
      source: {
        kind: 'raster',
        objectId: 'photo-1',
        source: 'photo.png',
        passIndex: 0,
        rowIndex: 0,
        spanIndex: 0,
        pixelStartX: 1,
        pixelEndX: 2,
      },
      polyline: [
        { x: 11, y: 20.5 },
        { x: 13, y: 20.5 },
      ],
    });
    expect(tp.steps[4]).toMatchObject({
      kind: 'travel',
      from: { x: 15, y: 21.5 },
      to: { x: 14, y: 21.5 },
    });
    expect(tp.steps[5]).toMatchObject({
      kind: 'cut',
      color: '#444444',
      polyline: [
        { x: 14, y: 21.5 },
        { x: 12, y: 21.5 },
      ],
    });
    expect(cuts[1]).toMatchObject({
      kind: 'cut',
      source: {
        kind: 'raster',
        passIndex: 0,
        rowIndex: 1,
        spanIndex: 0,
        pixelStartX: 2,
        pixelEndX: 3,
      },
    });
  });

  it('preserves raster row metadata when slicing through a partial row', () => {
    const tp = buildToolpath(
      rasterJob(
        rasterGroup({
          sourceObjectId: 'photo-1',
          source: 'photo.png',
          pixelWidth: 4,
          pixelHeight: 1,
          sValues: new Uint16Array([0, 500, 500, 0]),
        }),
      ),
    );
    const cutIndex = tp.steps.findIndex((step) => step.kind === 'cut');
    const cutStart = tp.steps.slice(0, cutIndex).reduce((sum, step) => sum + step.length, 0);
    const cut = tp.steps[cutIndex];
    if (cut?.kind !== 'cut') throw new Error('expected raster cut step');

    const sliced = sliceToolpath(tp, cutStart + cut.length / 2);

    expect(sliced.partial).toMatchObject({
      kind: 'cut',
      source: cut.source,
    });
  });
});
