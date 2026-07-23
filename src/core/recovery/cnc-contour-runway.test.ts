import { describe, expect, it } from 'vitest';
import type { CncGroup, Job } from '../job';
import type { Vec2 } from '../scene';
import { buildCncRecoveryEventManifest } from './cnc-recovery-manifest';
import { planCncContourRunway, type CncContourRunwayPlan } from './cnc-contour-runway';

function contourJob(polyline: ReadonlyArray<Vec2>, feedMmPerMin = 600): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'layer-a',
    color: '#000000',
    cutType: 'profile-outside',
    toolId: 'tool-1',
    toolDiameterMm: 3.175,
    feedMmPerMin,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    coolant: 'mist',
    safeZMm: 5,
    passes: [{ kind: 'contour', zMm: -2, polyline, closed: false }],
  };
  return { groups: [group] };
}

// A flat led profile pass (ADR-250): a path3d whose points all sit at the cut
// depth. Runway recovery should treat its XY points as a contour.
function flatLeadPath3dJob(polyline: ReadonlyArray<Vec2>, zMm = -2): Job {
  const group: CncGroup = {
    kind: 'cnc',
    layerId: 'layer-a',
    color: '#000000',
    cutType: 'profile-outside',
    toolId: 'tool-1',
    toolDiameterMm: 3.175,
    feedMmPerMin: 600,
    plungeMmPerMin: 180,
    spindleRpm: 12_000,
    spindleSpinupSec: 3,
    coolant: 'mist',
    safeZMm: 5,
    passes: [
      {
        kind: 'path3d',
        points: polyline.map((point) => ({ x: point.x, y: point.y, z: zMm })),
        closed: false,
      },
    ],
  };
  return { groups: [group] };
}

function planFor(
  job: Job,
  uncertaintyEventId: string,
  minRunwayMm: number,
): ReturnType<typeof planCncContourRunway> {
  const segmentNumber = Number(uncertaintyEventId.match(/cut-(\d+)$/)?.[1] ?? 1);
  return planCncContourRunway({
    job,
    manifest: buildCncRecoveryEventManifest(job),
    uncertaintyEventId,
    clearedPathEvidence: {
      kind: 'committed-through-event',
      eventId: uncertaintyEventId.replace(/cut-\d+$/, `cut-${segmentNumber - 1}`),
      proofId: 'execution-fence-4',
    },
    profile: {
      qualificationId: 'machine-profile-4040-v1',
      minRunwayMm,
      accelerationMmPerSec2: 100,
      safetyMarginMm: 2,
    },
  });
}

function expectPlan(result: ReturnType<typeof planCncContourRunway>): CncContourRunwayPlan {
  expect(result.kind).toBe('review-plan');
  if (result.kind !== 'review-plan') throw new Error(`Expected a plan, received ${result.reason}.`);
  expect(result.executable).toBe(false);
  return result;
}

describe('planCncContourRunway', () => {
  it('backs up along proven straight geometry and replays through the uncertain segment', () => {
    const job = contourJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    const plan = expectPlan(planFor(job, 'cnc-op-1/pass-1/cut-3', 12));
    expect(plan.requiredRunwayMm).toBe(12);
    expect(plan.availableClearedMm).toBe(20);
    expect(plan.runwayPolyline).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(plan.recoveryPolyline).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    expect(plan.uncertaintyStartPointIndex).toBe(2);
    expect(plan.motion).toMatchObject({
      cutZMm: -2,
      safeZMm: 5,
      feedMmPerMin: 600,
      spindleRpm: 12_000,
      coolant: 'mist',
    });
  });

  it('plans a runway from a flat led path3d pass, reading its cut depth (ADR-250)', () => {
    const job = flatLeadPath3dJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
    const plan = expectPlan(planFor(job, 'cnc-op-1/pass-1/cut-3', 12));
    expect(plan.motion.cutZMm).toBe(-2); // read from the flat path3d's Z
    expect(plan.runwayPolyline).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(plan.recoveryPolyline).toEqual([
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
      { x: 30, y: 0 },
    ]);
  });

  it('refuses a runway that would depend on acceleration through a corner', () => {
    const job = contourJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ]);
    expect(planFor(job, 'cnc-op-1/pass-1/cut-3', 15)).toEqual({
      kind: 'error',
      reason: 'non-tangent-runway',
      requiredRunwayMm: 15,
      availableClearedMm: 0,
    });
  });

  it('uses the acceleration distance when it exceeds the configured minimum', () => {
    const job = contourJob(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
      ],
      1_200,
    );
    const result = planCncContourRunway({
      job,
      manifest: buildCncRecoveryEventManifest(job),
      uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
      clearedPathEvidence: {
        kind: 'committed-through-event',
        eventId: 'cnc-op-1/pass-1/cut-1',
        proofId: 'execution-fence-4',
      },
      profile: {
        qualificationId: 'machine-profile-4040-v1',
        minRunwayMm: 2,
        accelerationMmPerSec2: 50,
        safetyMarginMm: 2,
      },
    });
    expect(expectPlan(result).requiredRunwayMm).toBe(6);
  });

  it('refuses the first segment and an insufficient cleared path', () => {
    const job = contourJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(planFor(job, 'cnc-op-1/pass-1/cut-1', 5)).toEqual({
      kind: 'error',
      reason: 'first-segment-unproved',
    });
    expect(planFor(job, 'cnc-op-1/pass-1/cut-2', 15)).toEqual({
      kind: 'error',
      reason: 'insufficient-cleared-distance',
      requiredRunwayMm: 15,
      availableClearedMm: 10,
    });
  });

  it('refuses non-cut events, invalid profiles, and non-finite geometry', () => {
    const job = contourJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(planFor(job, 'cnc-op-1/pass-1/entry', 5)).toMatchObject({
      kind: 'error',
      reason: 'event-not-runway-eligible',
    });
    expect(
      planCncContourRunway({
        job,
        manifest: buildCncRecoveryEventManifest(job),
        uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
        clearedPathEvidence: {
          kind: 'committed-through-event',
          eventId: 'cnc-op-1/pass-1/cut-1',
          proofId: 'execution-fence-4',
        },
        profile: {
          qualificationId: 'machine-profile-4040-v1',
          minRunwayMm: 5,
          accelerationMmPerSec2: 0,
          safetyMarginMm: 0,
        },
      }),
    ).toEqual({ kind: 'error', reason: 'invalid-profile' });
    const invalidJob = contourJob([
      { x: 0, y: 0 },
      { x: Number.NaN, y: 0 },
      { x: 20, y: 0 },
    ]);
    expect(planFor(invalidJob, 'cnc-op-1/pass-1/cut-2', 5)).toEqual({
      kind: 'error',
      reason: 'invalid-geometry',
    });
  });

  it('refuses missing cleared-path proof and a caller-forged runway event', () => {
    const job = contourJob([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 20, y: 0 },
    ]);
    const manifest = buildCncRecoveryEventManifest(job);
    expect(
      planCncContourRunway({
        job,
        manifest,
        uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
        clearedPathEvidence: {
          kind: 'committed-through-event',
          eventId: 'cnc-op-1/pass-1/cut-1',
          proofId: '',
        },
        profile: {
          qualificationId: 'machine-profile-4040-v1',
          minRunwayMm: 5,
          accelerationMmPerSec2: 100,
          safetyMarginMm: 0,
        },
      }),
    ).toEqual({ kind: 'error', reason: 'cleared-path-unproved' });

    const forged = {
      ...manifest,
      events: manifest.events.map((event) =>
        event.id === 'cnc-op-1/pass-1/cut-2' ? { ...event, toolKey: 'forged-tool' } : event,
      ),
    };
    expect(
      planCncContourRunway({
        job,
        manifest: forged,
        uncertaintyEventId: 'cnc-op-1/pass-1/cut-2',
        clearedPathEvidence: {
          kind: 'committed-through-event',
          eventId: 'cnc-op-1/pass-1/cut-1',
          proofId: 'execution-fence-4',
        },
        profile: {
          qualificationId: 'machine-profile-4040-v1',
          minRunwayMm: 5,
          accelerationMmPerSec2: 100,
          safetyMarginMm: 0,
        },
      }),
    ).toEqual({ kind: 'error', reason: 'source-mismatch' });
  });
});
