import { describe, expect, it } from 'vitest';
import { cncContourEmissionPoints } from '../cnc/cnc-contour-emission';
import { DEFAULT_DEVICE_PROFILE } from '../devices';
import { estimateJobDuration } from './estimate-duration';
import { cncGrblStrategy } from '../output/cnc-grbl-strategy';
import type { CncContourPass, CncGroup, Job } from './job';

function cncJob(pass: CncContourPass): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'contour',
    color: '#ff0000',
    cutType: 'profile-on-path',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 120,
    spindleRpm: 12_000,
    spindleSpinupSec: 0,
    safeZMm: 5,
    passes: [pass],
  };
  return { groups: [group] };
}

function contour(polyline: CncContourPass['polyline']): CncContourPass {
  return { kind: 'contour', zMm: -1, polyline, closed: false };
}

describe('CNC contour duration parity', () => {
  it('omits the collapsed contour while retaining emitted safe-Z and delivery time', () => {
    const pass = contour([
      { x: 247.01767, y: 20 },
      { x: 247.01768, y: 20 },
    ]);

    expect(cncContourEmissionPoints(pass)).toEqual([]);
    const job = cncJob(pass);
    const program = cncGrblStrategy.emit(job, DEFAULT_DEVICE_PROFILE);
    const estimate = estimateJobDuration(job, DEFAULT_DEVICE_PROFILE);
    expect(program).not.toContain('X247.');
    expect(program).not.toContain('\nG1 ');
    expect(estimate.breakdown.cutSeconds).toBe(0);
    expect(estimate.breakdown.feedTravelSeconds).toBe(0);
    expect(estimate.breakdown.rapidTravelSeconds).toBeCloseTo(
      2 * Math.sqrt(5 / DEFAULT_DEVICE_PROFILE.accelMmPerSec2),
      8,
    );
    expect(estimate.totalSeconds).toBeCloseTo(
      estimate.breakdown.travelSeconds + (estimate.breakdown.transportSeconds ?? 0),
      8,
    );
  });

  it('prices only the parser-represented portion of a partially collapsed contour', () => {
    const requested = contour([
      { x: 10_000, y: 20_000 },
      { x: 10_001, y: 20_000 },
      { x: 10_001.0004, y: 20_000.0004 },
    ]);
    const represented = contour(cncContourEmissionPoints(requested));

    expect(cncContourEmissionPoints(requested)).toHaveLength(2);
    expect(estimateJobDuration(cncJob(requested), DEFAULT_DEVICE_PROFILE)).toEqual(
      estimateJobDuration(cncJob(represented), DEFAULT_DEVICE_PROFILE),
    );
  });
});
