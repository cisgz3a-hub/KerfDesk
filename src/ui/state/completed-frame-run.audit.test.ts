import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createStreamer } from '../../core/controllers/grbl/streamer';
import { useStore } from './store';
import type { FramedRunPermit } from './framed-run';
import { type LaserState, useLaserStore } from './laser-store';
import { initialLaserState } from './laser-store-helpers';
import { completedFrameRunIsOwned, settledCompletedFramePatch } from './completed-frame-run';
import { FRAME_ONCE_IDLE, installFrameOnceProject } from '../laser/frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { framedRunReadinessIssue } from '../laser/framed-run-readiness';

beforeEach(installFrameOnceProject);
afterEach(() => useLaserStore.setState(initialLaserState()));

function completedState(frame: FramedRunPermit, patch: Partial<LaserState> = {}): LaserState {
  return {
    ...useLaserStore.getState(),
    framedRun: null,
    completedFrame: frame,
    streamer: { ...createStreamer(frame.candidate.preparedStart.gcode), status: 'done' },
    streamerEpoch: 9,
    activeRunId: 'owned-frame-run',
    completedFrameRunOwner: { frame, streamerEpoch: 9, runId: 'owned-frame-run' },
    ...patch,
  };
}

function finishAt(x: number, y: number): LaserState['statusReport'] {
  return { ...FRAME_ONCE_IDLE, mPos: { x, y, z: 0 } };
}

describe('reusable Frame rebases only after its own clean execution', () => {
  it('keeps absolute placement after owned motion and records the actual settled head', async () => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    const completed = completedState(frame, { statusReport: finishAt(10, 290) });
    const patch = settledCompletedFramePatch(completed);
    const retained = patch.completedFrame;
    expect(retained).not.toBeNull();
    expect(retained?.candidate).toBe(frame.candidate);
    expect(retained?.controller.statusReport?.mPos).toEqual({ x: 10, y: 290, z: 0 });
    expect(patch.completedFrameRunOwner).toBeNull();
    expect(
      framedRunReadinessIssue(retained ?? null, undefined, { ...completed, ...patch }),
    ).toBeNull();
  });

  it('keeps Current Position only when its resolved physical placement remains unchanged', async () => {
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    expect(settledCompletedFramePatch(completedState(frame)).completedFrame).not.toBeNull();
    expect(
      settledCompletedFramePatch(completedState(frame, { statusReport: finishAt(10, 290) })),
    ).toEqual({ completedFrame: null, completedFrameRunOwner: null, frameVerification: null });
  });

  it.each<Partial<LaserState>>([
    { controllerSessionEpoch: 8 },
    { wcoCache: { x: 0, y: 0, z: 1 } },
    { workOriginActive: true, workOriginSource: 'g92' },
    { trustedPositionEpoch: 1 },
    { workZReferenceEpoch: 1 },
    { alarmCode: 3 },
    { connection: { kind: 'disconnected' } },
    { statusReport: { ...FRAME_ONCE_IDLE, state: 'Run' } },
    {
      controllerSettings: {
        maxPowerS: 1000,
        minPowerS: 0,
        laserModeEnabled: true,
        reportInches: true,
      },
    },
  ])('refuses to adopt changed spatial controller evidence at settlement: %j', async (change) => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    const state = completedState(frame, change);
    expect(settledCompletedFramePatch(state)).toEqual({
      completedFrame: null,
      completedFrameRunOwner: null,
      frameVerification: null,
    });
  });

  it.each<Partial<LaserState>>([
    { streamerEpoch: 10 },
    { activeRunId: 'replacement-run' },
    { streamer: null },
    { completedFrameRunOwner: null },
  ])('does not adopt a missing or replacement execution owner: %j', async (change) => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    const state = completedState(frame, change);
    expect(completedFrameRunIsOwned(state)).toBe(false);
    expect(settledCompletedFramePatch(state)).toEqual({});
  });

  it('does not adopt a replacement completed Frame at the same streamer epoch', async () => {
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    const state = completedState(frame, { completedFrame: { ...frame } });
    expect(completedFrameRunIsOwned(state)).toBe(false);
    expect(settledCompletedFramePatch(state)).toEqual({});
  });
});
