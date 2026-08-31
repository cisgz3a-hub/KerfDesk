import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cncContourEmissionPoints } from '../cnc/cnc-contour-emission';
import type { CncContourPass, CncGroup, Job } from '../job';
import type { Vec2 } from '../scene';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';
import { planCncContourRunway, type CncContourRunwayPlan } from './cnc-contour-runway';

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

function contourPass(job: Job): CncContourPass {
  const group = job.groups[0];
  if (group?.kind !== 'cnc') throw new Error('Expected CNC group.');
  const pass = group.passes[0];
  if (pass?.kind !== 'contour') throw new Error('Expected contour pass.');
  return pass;
}

function pointAt(points: ReadonlyArray<Vec2>, index: number): Vec2 {
  const point = points[index];
  if (point === undefined) throw new Error(`Expected represented point ${index}.`);
  return point;
}

function expectPlan(result: ReturnType<typeof planCncContourRunway>): CncContourRunwayPlan {
  expect(result.kind).toBe('review-plan');
  if (result.kind !== 'review-plan') throw new Error(`Expected a plan, received ${result.reason}.`);
  return result;
}

function assertRepresentedRunway(first: number, second: number, ratio: number): void {
  const job = straightContourJob(first, second);
  const representedSource = cncContourEmissionPoints(contourPass(job));
  const representedStart = pointAt(representedSource, 0);
  const representedAnchor = pointAt(representedSource, 2);
  const representedAvailable = Math.hypot(
    representedAnchor.x - representedStart.x,
    representedAnchor.y - representedStart.y,
  );
  const required = representedAvailable * ratio;
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
  const plan = expectPlan(result);
  expect(plan.executable).toBe(false);
  const start = pointAt(plan.runwayPolyline, 0);
  const end = pointAt(plan.runwayPolyline, plan.runwayPolyline.length - 1);
  expect(end).toEqual(representedAnchor);
  expect(end.x - start.x + 1e-9).toBeGreaterThanOrEqual(required);
  expect(plan.recoveryPolyline).toEqual(
    cncContourEmissionPoints({
      kind: 'contour',
      zMm: plan.motion.cutZMm,
      closed: false,
      polyline: plan.recoveryPolyline,
    }),
  );
}

describe('planCncContourRunway properties', () => {
  it('makes a represented straight runway at least the requested length and ends at the anchor', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 1, max: 50, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 1, noNaN: true, noDefaultInfinity: true }),
        assertRepresentedRunway,
      ),
    );
  });
});
