import { describe, expect, it } from 'vitest';
import { analyzeFillHeatRisk } from './fill-heat-risk';
import type { FillGroup, FillSegment, Job } from './job';

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
    speed: 1500,
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
});
