import { describe, expect, it } from 'vitest';
import { analyzeFillHeatRisk } from './fill-heat-risk';
import type { FillGroup, FillSegment, Job } from './job';

const BURN_FEED_MM_PER_MIN = 1500;
const COLLAPSING_SCAN_OFFSET_MM = 0.0008;

function sweep(y: number, length: number): FillSegment {
  return {
    polyline: [
      { x: 10, y },
      { x: 10 + length, y },
    ],
    closed: false,
    reverse: false,
  };
}

function group(overrides: Partial<FillGroup>): FillGroup {
  return {
    kind: 'fill',
    layerId: 'fill',
    color: '#000000',
    power: 30,
    speed: BURN_FEED_MM_PER_MIN,
    passes: 1,
    airAssist: false,
    fillStyle: 'scanline',
    fillRunwayPolicy: 'legacy-skip',
    overscanMm: 5,
    segments: [sweep(1, 3), sweep(2, 20)],
    ...overrides,
  };
}

describe('analyzeFillHeatRisk runway coverage', () => {
  it('reports exact emitted pass coverage and separates disabled from skipped runway', () => {
    const job: Job = {
      groups: [
        group({ passes: 2 }),
        group({ layerId: 'disabled', passes: 3, overscanMm: 0, segments: [sweep(3, 4)] }),
      ],
    };

    expect(analyzeFillHeatRisk(job)).toMatchObject({
      fillSweepCount: 7,
      fillFullRunwaySweepCount: 2,
      fillPartialRunwaySweepCount: 0,
      fillNoRunwaySweepCount: 2,
      fillDisabledRunwaySweepCount: 3,
      fillRequestedRunwayValuesMm: [0, 5],
      minFillSweepMm: 3,
    });
  });

  it('reports every short 4040 full-policy sweep as full runway', () => {
    expect(analyzeFillHeatRisk({ groups: [group({ fillRunwayPolicy: 'full' })] })).toMatchObject({
      fillSweepCount: 2,
      fillFullRunwaySweepCount: 2,
      fillPartialRunwaySweepCount: 0,
      fillNoRunwaySweepCount: 0,
      fillDisabledRunwaySweepCount: 0,
    });
  });

  it('excludes a reverse sweep that collapses after scan-offset translation', () => {
    const collapsingSweep: FillSegment = {
      polyline: [
        { x: 10.0012, y: 1 },
        { x: 10.0004, y: 1 },
      ],
      closed: false,
      reverse: true,
    };
    const job: Job = {
      groups: [
        group({
          fillRunwayPolicy: 'feed-matched-every-sweep',
          segments: [collapsingSweep],
        }),
      ],
    };

    expect(
      analyzeFillHeatRisk(job, [
        {
          speedMmPerMin: BURN_FEED_MM_PER_MIN,
          offsetMm: COLLAPSING_SCAN_OFFSET_MM,
        },
      ]),
    ).toMatchObject({
      fillSweepCount: 0,
      fillFullRunwaySweepCount: 0,
      fillNoRunwaySweepCount: 0,
    });
  });

  it('requires both sides of every generic split sweep for full-runway coverage', () => {
    const job: Job = {
      groups: [
        group({
          fillRunwayPolicy: 'feed-matched-every-sweep',
          segments: [
            {
              ...sweep(1, 1),
              polyline: [
                { x: 0, y: 1 },
                { x: 1, y: 1 },
              ],
            },
            {
              ...sweep(1, 1),
              polyline: [
                { x: 7, y: 1 },
                { x: 8, y: 1 },
              ],
            },
          ],
        }),
      ],
    };

    expect(analyzeFillHeatRisk(job)).toMatchObject({
      fillSweepCount: 2,
      fillFullRunwaySweepCount: 0,
      fillPartialRunwaySweepCount: 2,
      fillNoRunwaySweepCount: 0,
      fillDisabledRunwaySweepCount: 0,
      fillRequestedRunwayValuesMm: [5],
    });
  });

  it('reports the effective generic fallback instead of a disabled zero-runway sweep', () => {
    expect(
      analyzeFillHeatRisk({
        groups: [
          group({
            fillRunwayPolicy: 'feed-matched-every-sweep',
            overscanMm: 0,
            segments: [sweep(1, 1)],
          }),
        ],
      }),
    ).toMatchObject({
      fillSweepCount: 1,
      fillFullRunwaySweepCount: 1,
      fillDisabledRunwaySweepCount: 0,
      fillRequestedRunwayValuesMm: [5],
    });
  });
});
