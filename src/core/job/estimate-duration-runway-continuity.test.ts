import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE, NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { FillGroup, RasterGroup } from './job';
import { blockTime } from './planner';

const neotronicsDevice = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

const genericDevice = {
  ...DEFAULT_DEVICE_PROFILE,
  maxFeed: 6000,
  accelMmPerSec2: 1000,
  junctionDeviationMm: 0.01,
};

describe('full-runway duration continuity', () => {
  it('does not add fictitious stops at 100 Fill S0/burn boundaries', () => {
    const fill: FillGroup = {
      ...baseFill(),
      fillRunwayPolicy: 'full',
      segments: Array.from({ length: 100 }, (_, row) => {
        const reverse = row % 2 === 1;
        return {
          polyline: reverse
            ? [
                { x: 13, y: row },
                { x: 10, y: row },
              ]
            : [
                { x: 10, y: row },
                { x: 13, y: row },
              ],
          closed: false,
          reverse,
        };
      }),
    };
    const estimate = estimateJobDuration({ groups: [fill] }, neotronicsDevice, {
      initialPosition: { x: 5, y: 0 },
      finishPosition: null,
    });

    // This floor excludes every inter-row seek. A planner that stops at all
    // three row blocks already exceeds it before those real travels are added.
    expect(estimate.totalSeconds).toBeLessThan(stoppedBoundaryFloorSeconds());
    expect(estimate.breakdown.cutSeconds).toBeGreaterThan(0);
    expect(estimate.breakdown.travelSeconds).toBeGreaterThan(0);
  });

  it('does not add fictitious stops at 100 Raster S0/burn boundaries', () => {
    const raster: RasterGroup = {
      kind: 'raster',
      layerId: 'image',
      color: '#000',
      power: 50,
      speed: 6000,
      passes: 1,
      airAssist: false,
      sValues: new Uint16Array(3 * 100).fill(500),
      pixelWidth: 3,
      pixelHeight: 100,
      bounds: { minX: 10, minY: 0, maxX: 13, maxY: 100 },
      overscanMm: 5,
      dotWidthCorrectionMm: 0,
      bidirectional: true,
    };
    const estimate = estimateJobDuration({ groups: [raster] }, neotronicsDevice, {
      initialPosition: { x: 5, y: 0.5 },
      finishPosition: null,
    });

    expect(estimate.totalSeconds).toBeLessThan(stoppedBoundaryFloorSeconds());
  });

  it('keeps generic legacy-skip behavior identical to the implicit default', () => {
    const base: FillGroup = {
      ...baseFill(),
      speed: 1000,
      segments: [
        {
          polyline: [
            { x: 10, y: 0 },
            { x: 30, y: 0 },
          ],
          closed: false,
          reverse: false,
        },
      ],
    };
    const explicit = estimateJobDuration(
      { groups: [{ ...base, fillRunwayPolicy: 'legacy-skip' }] },
      genericDevice,
    );
    const implicit = estimateJobDuration({ groups: [base] }, genericDevice);

    expect(explicit).toEqual(implicit);
  });
});

function baseFill(): FillGroup {
  return {
    kind: 'fill',
    layerId: 'fill',
    color: '#000',
    power: 50,
    speed: 6000,
    passes: 1,
    airAssist: false,
    overscanMm: 5,
    segments: [],
  };
}

function stoppedBoundaryFloorSeconds(): number {
  const restToRest = (distance: number): number =>
    blockTime(
      {
        kind: 'cut',
        distance,
        targetVelocity: 6000 / 60,
        direction: { x: 1, y: 0 },
      },
      0,
      0,
      1000,
    );
  return 100 * (restToRest(5) + restToRest(3) + restToRest(5));
}
