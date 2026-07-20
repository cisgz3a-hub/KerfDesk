import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { FillGroup, RasterGroup } from './job';

const SPARSE_ROW = [500, 0, 0, 0, 0, 0, 0, 500];

describe('raster split-runway duration', () => {
  it('prices the emitted bounded path instead of the former reversing runways', () => {
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'image',
      color: '#000',
      power: 50,
      speed: 1500,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array(SPARSE_ROW),
      pixelWidth: SPARSE_ROW.length,
      pixelHeight: 1,
      bounds: { minX: 0, minY: 0, maxX: SPARSE_ROW.length, maxY: 1 },
      overscanMm: 5,
      dotWidthCorrectionMm: 0,
      bidirectional: false,
    };
    const formerModel: FillGroup = {
      kind: 'fill',
      layerId: 'former-raster-model',
      color: '#000',
      power: raster.power,
      speed: raster.speed,
      passes: raster.passes,
      airAssist: raster.airAssist,
      overscanMm: raster.overscanMm,
      fillRunwayPolicy: 'raster-full',
      segments: [
        {
          polyline: [
            { x: 0, y: 0.5 },
            { x: 1, y: 0.5 },
          ],
          closed: false,
          reverse: false,
        },
        {
          polyline: [
            { x: 7, y: 0.5 },
            { x: 8, y: 0.5 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    };
    const options = { initialPosition: { x: -5, y: 0.5 }, finishPosition: null };

    const bounded = estimateJobDuration(
      { groups: [raster] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      options,
    );
    const reversing = estimateJobDuration(
      { groups: [formerModel] },
      NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
      options,
    );
    const genericSeek = estimateJobDuration(
      { groups: [raster] },
      {
        ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
        controlledLaserOffTravelFeedMmPerMin: undefined,
      },
      options,
    );

    expect(bounded.breakdown.travelSeconds).toBeLessThan(reversing.breakdown.travelSeconds);
    expect(bounded.totalSeconds).toBeLessThan(reversing.totalSeconds);
    expect(bounded.breakdown.feedTravelSeconds).toBeGreaterThan(0);
    expect(bounded.breakdown.rapidTravelSeconds).toBe(0);
    expect(genericSeek.breakdown.rapidTravelSeconds).toBeGreaterThan(0);
  });
});
