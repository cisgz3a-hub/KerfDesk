import { describe, expect, it } from 'vitest';
import { NEOTRONICS_4040_MAX_LT4LDS_V2_PROFILE } from '../devices';
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
    // Start at each emitted approach target to isolate the entry itself.
    // This profile's ordinary seeks are also G1 feed travel; comparing their
    // changing approach distances would obscure the 5 mm runway contribution.
    const withEntry = estimateJobDuration(
      { groups: [{ ...baseGroup, entryRunwayMm: 5 }] },
      device,
      { initialPosition: { x: 5, y: 10 } },
    );
    const withoutEntry = estimateJobDuration({ groups: [baseGroup] }, device, {
      initialPosition: { x: 10, y: 10 },
    });

    // The 5 mm laser-off ramp is timed as feed travel. Total time is NOT
    // asserted greater: the collinear entry lets the burn start at speed
    // instead of stopping at the seek junction, which can shorten the job —
    // the exact physics the entry exists for.
    expect(withoutEntry.breakdown.feedTravelSeconds).toBe(0);
    expect(withEntry.breakdown.feedTravelSeconds).toBeGreaterThanOrEqual(
      ((5 * 60) / baseGroup.speed) * (device.estimateTravelTimeScale ?? 1),
    );
  });
});
