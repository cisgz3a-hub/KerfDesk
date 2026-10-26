import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import type { Job } from './job';
import { computeJobBounds, computeJobPlacementBounds } from './job-bounds';

// ADR-052 Amendment 1: the compensation only moves commanded reverse rows onto
// the forward rows' burn, so Job Origin measures them at design.
describe('computeJobPlacementBounds', () => {
  const rasterJob = (bidirectionalScanOffsetMm?: number): Job => ({
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
        overscanMm: 1,
        dotWidthCorrectionMm: 0,
        ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
      },
    ],
  });
  const fillJob = (bidirectionalScanOffsetMm?: number): Job => ({
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
        ...(bidirectionalScanOffsetMm === undefined ? {} : { bidirectionalScanOffsetMm }),
        segments: [
          {
            polyline: [
              { x: 5, y: 10 },
              { x: 10, y: 10 },
            ],
            closed: false,
            reverse: false,
          },
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
  });
  const withTable = (offsetMm: number) => ({
    ...DEFAULT_DEVICE_PROFILE,
    scanningOffsets: [{ speedMmPerMin: 6000, offsetMm }],
  });

  it.each([0.25, -0.25])('keeps image rows at design with a %s mm table', (offsetMm) => {
    const device = withTable(offsetMm);
    const design = { minX: 0, minY: 0, maxX: 2, maxY: 2 };

    expect(computeJobPlacementBounds(rasterJob(), device)).toEqual(design);
    expect(computeJobPlacementBounds(rasterJob(offsetMm), DEFAULT_DEVICE_PROFILE)).toEqual(design);
    // Burn bounds keep the commanded reverse row: -0.25 left, or +0.25 right.
    expect(computeJobBounds(rasterJob(), device)).toEqual(
      offsetMm > 0 ? { ...design, minX: -0.25 } : { ...design, maxX: 2.25 },
    );
  });

  it.each([0.5, -0.5])('keeps fill sweeps at design with a %s mm table', (offsetMm) => {
    const device = withTable(offsetMm);
    const design = { minX: 5, minY: 10, maxX: 10, maxY: 20 };

    expect(computeJobPlacementBounds(fillJob(), device)).toEqual(design);
    expect(computeJobPlacementBounds(fillJob(offsetMm), DEFAULT_DEVICE_PROFILE)).toEqual(design);
    // The reverse sweep travels -X: +0.5 commands it 0.5 left, -0.5 0.5 right.
    expect(computeJobBounds(fillJob(), device)).toEqual(
      offsetMm > 0 ? { ...design, minX: 4.5 } : { ...design, maxX: 10.5 },
    );
  });
});
