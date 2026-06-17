import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from './job';
import { computeJobBounds, computeJobMotionBounds } from './job-bounds';

const empty: Job = { groups: [] };

const job: Job = {
  groups: [
    {
      kind: 'cut',
      layerId: 'L1',
      color: '#ff0000',
      power: 30,
      speed: 1500,
      passes: 1,
      airAssist: false,
      segments: [
        {
          polyline: [
            { x: 10, y: 20 },
            { x: 100, y: 20 },
          ],
          closed: false,
        },
        {
          polyline: [
            { x: 50, y: 5 },
            { x: 50, y: 80 },
          ],
          closed: false,
        },
      ],
    },
  ],
};

describe('computeJobBounds', () => {
  it('returns null for an empty job', () => {
    expect(computeJobBounds(empty)).toBeNull();
  });

  it('returns the AABB across all polylines', () => {
    expect(computeJobBounds(job)).toEqual({
      minX: 10,
      minY: 5,
      maxX: 100,
      maxY: 80,
    });
  });

  it('uses fill burn bounds without including overscan runway', () => {
    expect(
      computeJobBounds({
        groups: [
          {
            kind: 'fill',
            layerId: 'fill',
            color: '#000000',
            power: 30,
            speed: 1500,
            passes: 1,
            airAssist: false,
            overscanMm: 5,
            segments: [
              {
                polyline: [
                  { x: 10, y: 20 },
                  { x: 100, y: 20 },
                ],
                closed: false,
                reverse: false,
              },
            ],
          },
        ],
      }),
    ).toEqual({
      minX: 10,
      minY: 20,
      maxX: 100,
      maxY: 20,
    });
  });

  it('includes profile raster scan offsets in motion bounds', () => {
    const rasterJob: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#808080',
          power: 30,
          speed: 1000,
          passes: 1,
          airAssist: false,
          sValues: new Uint16Array([100, 100, 100, 100]),
          pixelWidth: 2,
          pixelHeight: 2,
          bounds: { minX: 10, minY: 0, maxX: 12, maxY: 2 },
          overscanMm: 1,
          dotWidthCorrectionMm: 0,
        },
      ],
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.25 }],
    };

    expect(computeJobMotionBounds(rasterJob, device)).toEqual({
      minX: 8.75,
      minY: 0,
      maxX: 13,
      maxY: 2,
    });
  });
});

describe('computeJobMotionBounds', () => {
  it('includes reverse raster scan-offset travel in the physical envelope', () => {
    const rasterJob: Job = {
      groups: [
        {
          kind: 'raster',
          layerId: 'image',
          color: '#000000',
          power: 30,
          speed: 6000,
          passes: 1,
          airAssist: false,
          sValues: new Uint16Array([0, 100, 100, 0]),
          pixelWidth: 2,
          pixelHeight: 2,
          bounds: { minX: 0, minY: 0, maxX: 2, maxY: 2 },
          overscanMm: 0,
          dotWidthCorrectionMm: 0,
        },
      ],
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: 0.25 }],
    };

    expect(computeJobBounds(rasterJob, device)).toEqual({
      minX: -0.25,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
    expect(computeJobMotionBounds(rasterJob, device)).toEqual({
      minX: -0.25,
      minY: 0,
      maxX: 2,
      maxY: 2,
    });
  });

  it('includes reverse fill scan-offset burn and overscan motion in the physical envelope', () => {
    const fillJob: Job = {
      groups: [
        {
          kind: 'fill',
          layerId: 'fill',
          color: '#000000',
          power: 30,
          speed: 6000,
          passes: 1,
          airAssist: false,
          overscanMm: 1,
          segments: [
            {
              polyline: [
                { x: 10, y: 20 },
                { x: 5, y: 20 },
              ],
              closed: false,
              reverse: true,
            },
          ],
        },
      ],
    };
    const device = {
      ...DEFAULT_DEVICE_PROFILE,
      scanningOffsets: [{ speedMmPerMin: 6000, offsetMm: 0.5 }],
    };

    expect(computeJobBounds(fillJob, device)).toEqual({
      minX: 4.5,
      minY: 20,
      maxX: 10,
      maxY: 20,
    });
    expect(computeJobMotionBounds(fillJob, device)).toEqual({
      minX: 3.5,
      minY: 20,
      maxX: 10.5,
      maxY: 20,
    });
  });
});
