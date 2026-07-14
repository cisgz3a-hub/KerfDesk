import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';
import { planCncContourRunway } from './cnc-contour-runway';

function straightContourJob(first: number, second: number): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'layer-a',
    color: '#000000',
    cutType: 'profile-outside',
    toolId: 'tool-1',
    toolDiameterMm: 3.175,
    feedMmPerMin: 60,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    coolant: 'mist',
    safeZMm: 5,
    passes: [
      {
        kind: 'contour',
        zMm: -2,
        closed: false,
        polyline: [
          { x: 0, y: 0 },
          { x: first, y: 0 },
          { x: first + second, y: 0 },
          { x: first + second + 10, y: 0 },
        ],
      },
    ],
  };
  return { groups: [group] };
}

describe('planCncContourRunway properties', () => {
  it('makes a straight runway the requested length and ends at the uncertainty anchor', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true, noDefaultInfinity: true }),
        (first, second, ratio) => {
          const required = (first + second) * ratio;
          const job = straightContourJob(first, second);
          const result = planCncContourRunway({
            job,
            manifest: buildCncRecoveryEventManifest(job),
            uncertaintyEventId: 'cnc-op-1/pass-1/cut-3',
            clearedPathEvidence: {
              kind: 'committed-through-event',
              eventId: 'cnc-op-1/pass-1/cut-2',
              proofId: 'execution-fence-4',
            },
            profile: {
              qualificationId: 'machine-profile-4040-v1',
              minRunwayMm: required,
              accelerationMmPerSec2: 1_000,
              safetyMarginMm: 0,
            },
          });
          expect(result.kind).toBe('review-plan');
          if (result.kind !== 'review-plan') {
            throw new Error(`Expected a plan, received ${result.reason}.`);
          }
          expect(result.executable).toBe(false);
          const start = result.runwayPolyline[0];
          const end = result.runwayPolyline[result.runwayPolyline.length - 1];
          expect(end).toEqual({ x: first + second, y: 0 });
          expect((end?.x ?? 0) - (start?.x ?? 0)).toBeCloseTo(required, 8);
        },
      ),
    );
  });
});
