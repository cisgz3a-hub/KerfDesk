import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import type { FillGroup } from './job';

const controller = {
  ...NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE,
  maxFeed: 2250,
  accelMmPerSec2: 300,
  junctionDeviationMm: 0.01,
};

function fillGroup(args: {
  readonly startX: number;
  readonly endX: number;
  readonly overscanMm: number;
  readonly fillRunwayPolicy?: 'feed-matched-entry';
}): FillGroup {
  return {
    kind: 'fill',
    layerId: 'script-name',
    color: '#000',
    power: 30,
    speed: 1500,
    passes: 1,
    airAssist: false,
    ...(args.fillRunwayPolicy === undefined ? {} : { fillRunwayPolicy: args.fillRunwayPolicy }),
    overscanMm: args.overscanMm,
    segments: [
      {
        polyline: [
          { x: args.startX, y: 0 },
          { x: args.endX, y: 0 },
        ],
        closed: false,
        reverse: false,
      },
    ],
  };
}

describe('4040 fill runway duration', () => {
  it('keeps continuous motion time while accounting S0 runways as feed travel', () => {
    const policy = fillGroup({
      startX: 5,
      endX: 7.352,
      overscanMm: 5,
      fillRunwayPolicy: 'feed-matched-entry',
    });
    const continuous = fillGroup({ startX: 0, endX: 12.352, overscanMm: 0 });

    const planned = estimateJobDuration({ groups: [policy] }, controller);
    const reference = estimateJobDuration({ groups: [continuous] }, controller);

    expect(planned.totalSeconds).toBeCloseTo(reference.totalSeconds, 6);
    expect(planned.breakdown.cutSeconds).toBeLessThan(reference.breakdown.cutSeconds);
    expect(planned.breakdown.feedTravelSeconds).toBeGreaterThan(0);
    expect(planned.breakdown.rapidTravelSeconds).toBeCloseTo(
      reference.breakdown.rapidTravelSeconds ?? 0,
      6,
    );
    expect(reference.breakdown.feedTravelSeconds).toBe(0);
  });

  it('applies the travel calibration factor to laser-off feed runways', () => {
    const policy = fillGroup({
      startX: 5,
      endX: 7.352,
      overscanMm: 5,
      fillRunwayPolicy: 'feed-matched-entry',
    });
    const baseline = estimateJobDuration({ groups: [policy] }, controller);
    const calibrated = estimateJobDuration(
      { groups: [policy] },
      { ...controller, estimateCutTimeScale: 1.25, estimateTravelTimeScale: 1.5 },
    );

    expect(calibrated.breakdown.cutSeconds).toBeCloseTo(baseline.breakdown.cutSeconds * 1.25, 8);
    expect(calibrated.breakdown.feedTravelSeconds).toBeCloseTo(
      (baseline.breakdown.feedTravelSeconds ?? 0) * 1.5,
      8,
    );
    expect(calibrated.breakdown.rapidTravelSeconds).toBeCloseTo(
      (baseline.breakdown.rapidTravelSeconds ?? 0) * 1.5,
      8,
    );
  });
});
