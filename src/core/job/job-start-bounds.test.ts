import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { grblStrategy } from '../output/grbl-strategy';
import type { CncGroup, CutGroup, FillGroup, Job, RasterGroup } from './job';
import { computeJobBounds, computeJobMotionBounds } from './job-bounds';
import { computeJobStartBounds } from './job-start-bounds';
import { buildMotionManifest } from './motion-manifest';

const device = DEFAULT_DEVICE_PROFILE;
const cut = (x: number, power = 50): CutGroup => ({
  kind: 'cut',
  layerId: 'cut',
  color: '#000',
  power,
  speed: 1000,
  passes: 1,
  airAssist: false,
  segments: [
    {
      closed: false,
      polyline: [
        { x, y: 0 },
        { x: x + 10, y: 10 },
      ],
    },
  ],
});
const raster = (sValues: Uint16Array): RasterGroup => ({
  kind: 'raster',
  layerId: 'raster',
  color: '#000',
  power: 50,
  speed: 1000,
  passes: 1,
  airAssist: false,
  pixelWidth: 3,
  pixelHeight: 3,
  bounds: { minX: 100, minY: 100, maxX: 103, maxY: 103 },
  sValues,
  overscanMm: 5,
  dotWidthCorrectionMm: 0,
});
const fill = (x: number): FillGroup => ({
  ...cut(0),
  kind: 'fill',
  overscanMm: 3,
  segments: [
    {
      closed: false,
      reverse: true,
      polyline: [
        { x: x + 0.0002, y: 20 },
        { x: x + 0.0001, y: 20 },
      ],
    },
  ],
});

function wireBounds(job: Job, outputDevice = device) {
  const points = buildMotionManifest(grblStrategy.emit(job, outputDevice), { machineKind: 'laser' })
    .blocks.filter((block) => block.kind === 'process')
    .flatMap((block) => block.points);
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

describe('cutting start preference bounds', () => {
  it('excludes zero-power, zero-pass, collapsed contours, and empty buffered or streamed rasters', () => {
    const blank = raster(new Uint16Array(9));
    const job: Job = {
      groups: [
        cut(0),
        cut(100, 0),
        { ...cut(200), passes: 0 },
        {
          ...cut(300),
          segments: [
            {
              closed: false,
              polyline: [
                { x: 300.0001, y: 0 },
                { x: 300.0002, y: 0 },
              ],
            },
          ],
        },
        blank,
        { ...blank, sValues: new Uint16Array(), rowProvider: () => new Uint16Array(3) },
        fill(400),
        { ...fill(500), fillStyle: 'offset' },
      ],
    };
    expect(computeJobStartBounds(job, device)).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    expect(computeJobBounds(job, device)?.maxX).toBeGreaterThan(500);
    expect(computeJobMotionBounds(job, device)?.maxX).toBeGreaterThan(500);
    expect(computeJobStartBounds({ groups: job.groups.slice(1) }, device)).toBeNull();
  });

  it('excludes partial-white raster padding and runways using actual powered sweep bounds', () => {
    const group = raster(new Uint16Array([0, 0, 0, 0, 500, 0, 0, 0, 0]));
    for (const scanAngleDeg of [0, 90]) {
      const job = { groups: [{ ...group, scanAngleDeg }] };
      expect(computeJobStartBounds(job, device)).toEqual(wireBounds(job));
    }
    expect(computeJobStartBounds({ groups: [group] }, device)).toEqual({
      minX: 101,
      maxX: 102,
      minY: 101.5,
      maxY: 101.5,
    });
  });

  it('uses calibrated reverse raster rows and dot-width-corrected powered runs', () => {
    const calibrated = { ...device, scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.4 }] };
    const group = {
      ...raster(new Uint16Array([0, 500, 0, 500, 0, 0, 0, 0, 0])),
      dotWidthCorrectionMm: 0.2,
    };
    const job = { groups: [group] };
    const actual = computeJobStartBounds(job, calibrated);
    const expected = wireBounds(job, calibrated);
    expect(actual).not.toBeNull();
    for (const key of ['minX', 'minY', 'maxX', 'maxY'] as const) {
      expect(actual?.[key]).toBeCloseTo(expected[key], 8);
    }
  });

  it('applies calibrated reverse fill precision before deciding its bounds', () => {
    const group = { ...fill(10), fillRunwayPolicy: 'feed-matched-every-sweep' as const };
    expect(computeJobStartBounds({ groups: [group] }, device)).toBeNull();
    const calibrated = { ...device, scanningOffsets: [{ speedMmPerMin: 1000, offsetMm: 0.00065 }] };
    const bounds = computeJobStartBounds({ groups: [group] }, calibrated);
    expect(bounds?.minX).toBeCloseTo(9.99945, 8);
    expect(bounds?.maxX).toBeCloseTo(9.99955, 8);
  });

  it('retains canonical represented CNC bounds including cutter radius without Frame fallback', () => {
    const group: CncGroup = {
      kind: 'cnc',
      layerId: 'cnc',
      color: '#000',
      cutType: 'engrave',
      toolDiameterMm: 4,
      feedMmPerMin: 600,
      plungeMmPerMin: 200,
      spindleRpm: 12000,
      spindleSpinupSec: 1,
      safeZMm: 5,
      passes: [
        {
          kind: 'contour',
          zMm: -1,
          closed: false,
          polyline: [
            { x: 10000, y: 20000 },
            { x: 10010, y: 20000 },
            { x: 10010.0004, y: 20000 },
          ],
        },
        {
          kind: 'contour',
          zMm: -1,
          closed: false,
          polyline: [
            { x: 30000, y: 20000 },
            { x: 30000.0004, y: 20000 },
          ],
        },
      ],
    };
    expect(computeJobStartBounds({ groups: [group] }, device)).toEqual({
      minX: 9998,
      minY: 19998,
      maxX: 10012,
      maxY: 20002,
    });
    expect(
      computeJobStartBounds({ groups: [{ ...group, passes: group.passes.slice(1) }] }, device),
    ).toBeNull();
  });
});
