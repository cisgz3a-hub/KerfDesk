import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
import { buildGcodeRenderModel } from '../gcode-view';
import { buildProgramTime } from '../gcode-time/program-time';
import { grblStrategy } from '../output/grbl-strategy';
import { estimateJobDuration } from './estimate-duration';
import type { CutGroup } from './job';

const square = {
  polyline: [
    { x: 10, y: 10 },
    { x: 20, y: 10 },
    { x: 20, y: 20 },
    { x: 10, y: 20 },
    { x: 10, y: 10 },
  ],
  closed: true,
};

const baseGroup: CutGroup = {
  kind: 'cut',
  layerId: 'outline',
  color: '#000000',
  power: 30,
  speed: 1500,
  passes: 1,
  airAssist: false,
  segments: [square],
};

describe('planner timing with ADR-239 contour entries', () => {
  it('times the tangential entry as laser-off feed travel', () => {
    const device = NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE;
    const job = { groups: [{ ...baseGroup, entryRunwayMm: 5 }] };
    const withEntry = estimateJobDuration(job, device);
    const parsed = buildGcodeRenderModel(grblStrategy.emit(job, device));
    if (parsed.kind !== 'ok') throw new Error(parsed.reason);
    const emitted = buildProgramTime(parsed.model, {
      accelMmPerSec2: device.accelMmPerSec2,
      junctionDeviationMm: device.junctionDeviationMm,
      maxFeedMmPerMin: device.maxFeed,
    });

    // Both the F800 seek and F1500 entry now belong to feed travel. Adding an
    // entry can shorten that total by replacing part of the slower seek.
    expect(withEntry.breakdown.feedTravelSeconds).toBeGreaterThan(0);
    expect(withEntry.breakdown.rapidTravelSeconds).toBe(0);
    expect(withEntry.totalSeconds).toBeCloseTo(emitted.totalSeconds, 6);
  });
});
