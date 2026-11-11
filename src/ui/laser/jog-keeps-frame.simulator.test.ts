// ADR-565 Amendment 1 (user annoyance audit A2-D-2): a completed Frame survives
// a clean app-owned XY jog when the job is placed by a fixed origin, and
// expires exactly as before in every other case. Real Frame, jog, Cancel and
// Start transactions run against the GRBL simulator with a non-zero work
// offset; nothing here mocks the store, the status pipeline or the
// invalidation subscription.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { reportedWorkPositionMm } from '../state/canvas-motion-plan';
import { disconnectOnTestClock } from '../state/laser-disconnect-testing';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { useToastStore } from '../state/toast-store';
import {
  connectedFixture,
  expectProgramSentOnce,
  startReviewedFrameOnClock,
} from './frame-artwork-centre-led.test-support';
import { frameExpiryReason } from './frame-expiry-note';
import {
  CONTROLLER_CHANGED_AFTER_FRAME_REASON,
  currentCompletedFrame,
  framedRunReadinessIssue,
} from './framed-run-readiness';
import type * as OutputPreparationWorker from './output-preparation-worker-client';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('./output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  resetStore();
  useLaserStore.setState(initialLaserState());
  useToastStore.setState({ toasts: [] });
});
afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const fixed = ['absolute', 'user-origin', 'verified-origin'] as const;
type Mode = (typeof fixed)[number] | 'current-position';
type Jog = Parameters<ReturnType<typeof useLaserStore.getState>['jog']>[0];

const laser = () => useLaserStore.getState();
const workXy = () => {
  const position = reportedWorkPositionMm(laser(), false);
  return position === null ? null : { x: position.x, y: position.y };
};

type Family = Parameters<typeof connectedFixture>[0];

async function framed(mode: Mode, family: Family = 'grbl-v1.1') {
  const fixture = await connectedFixture(family, mode);
  const framing = runFrameNow();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(await framing, JSON.stringify(useToastStore.getState().toasts)).toBe(true);
  const frame = laser().completedFrame;
  expect(frame).not.toBeNull();
  expect(laser().framedRun).toBe(frame);
  expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
  return { ...fixture, frame: frame!, framedAt: workXy()! };
}

async function jogAndSettle(params: Jog): Promise<void> {
  const jogging = laser().jog(params);
  await vi.advanceTimersByTimeAsync(3_000);
  await jogging;
  expect(laser().motionOperation).toBeNull();
}

function expectFrameGone(): void {
  expect(laser().framedRun).toBeNull();
  expect(laser().completedFrame).toBeNull();
  expect(laser().frameVerification).toBeNull();
  expect(framedRunReadinessIssue(currentCompletedFrame())).not.toBeNull();
}

describe('a clean XY jog keeps a completed Frame of a fixed placement', () => {
  it.each(fixed)(
    '%s: Frame, jog away, and Start burns the framed program where it was framed',
    async (mode) => {
      const { sim, frame, framedAt } = await framed(mode);
      const framedProgram = frame.candidate.preparedStart.gcode;

      const jogging = laser().jog({ dx: 30, dy: 20, feed: 1000 });
      await vi.advanceTimersByTimeAsync(20);
      // While the head moves no Frame is live, so Start cannot be pressed.
      expect(laser().motionOperation?.heldFrame?.frame).toBe(frame);
      expect(currentCompletedFrame()).toBeNull();
      await vi.advanceTimersByTimeAsync(3_000);
      await jogging;

      expect(workXy()).toEqual({ x: framedAt.x + 30, y: framedAt.y + 20 });
      const kept = laser().completedFrame;
      expect(kept?.candidate).toBe(frame.candidate);
      expect(laser().framedRun).toBe(kept);
      expect(laser().frameVerification).toBe(frame.candidate.frameVerification);
      // Only the observed head position was rebased.
      expect(kept?.controller.statusReport?.mPos).toEqual(laser().statusReport?.mPos);
      expect(kept?.controller.statusReport?.mPos).not.toEqual(frame.controller.statusReport?.mPos);
      expect(kept?.controller.wcoCache).toEqual(frame.controller.wcoCache);
      expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
      expect(frameExpiryReason()).toBeNull();

      const from = sim.outbound().length;
      await startReviewedFrameOnClock();
      // The exact program prepared for the Frame, before the head moved.
      expectProgramSentOnce(sim.outbound().slice(from), framedProgram);
      expect(laser().lastWriteError).toBeNull();
    },
  );

  it.each(['grblhal', 'fluidnc', 'marlin', 'smoothieware'] as const)(
    '%s: a jog keeps a User Origin Frame and Start sends the framed program',
    async (family) => {
      const { sim, frame, framedAt } = await framed('user-origin', family);
      const framedProgram = frame.candidate.preparedStart.gcode;
      await jogAndSettle({ dx: 30, dy: 20, feed: 1000 });
      expect(workXy()).toEqual({ x: framedAt.x + 30, y: framedAt.y + 20 });
      expect(laser().completedFrame?.candidate).toBe(frame.candidate);
      expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
      const from = sim.outbound().length;
      await startReviewedFrameOnClock();
      expectProgramSentOnce(sim.outbound().slice(from), framedProgram);
    },
  );

  it('keeps the Frame through a hold-to-jog stopped by a clean Cancel', async () => {
    const { frame, framedAt } = await framed('absolute');
    const jogging = laser().jog({ dx: 150, dy: 0, feed: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    expect(laser().motionOperation?.heldFrame?.frame).toBe(frame);
    const cancelling = laser().cancelJog();
    await vi.advanceTimersByTimeAsync(5_000);
    await cancelling;
    await jogging;
    expect(laser().motionOperation).toBeNull();
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    expect(laser().framedRun).toBe(laser().completedFrame);
    expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
    expect(workXy()).not.toEqual(framedAt);
  });

  it('keeps the Frame through step presses that join one jog, and a second jog', async () => {
    const { frame, framedAt } = await framed('user-origin');
    const first = laser().jog({ dx: 5, dy: 0, feed: 1000 }, undefined, { queueStep: true });
    await vi.advanceTimersByTimeAsync(5);
    const second = laser().jog({ dx: 5, dy: 0, feed: 1000 }, undefined, { queueStep: true });
    await vi.advanceTimersByTimeAsync(3_000);
    await Promise.all([first, second]);
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    await jogAndSettle({ dx: 0, dy: -7, feed: 1000 });
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    expect(workXy()).toEqual({ x: framedAt.x + 10, y: framedAt.y - 7 });
    expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
  });

  it('keeps the Frame through a jog another owner runs, such as the phone remote', async () => {
    const { frame } = await framed('absolute');
    const onMotionOwner = vi.fn();
    const jogging = laser().jog({ dx: 12, dy: 0, feed: 1000 }, { onMotionOwner });
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expect(onMotionOwner).toHaveBeenCalledTimes(1);
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
  });

  it('keeps the Frame through Move to position (a jog to a machine point)', async () => {
    const { frame } = await framed('absolute');
    const moving = laser().jogToMachinePosition(120, 70, 1000);
    await vi.advanceTimersByTimeAsync(3_000);
    await moving;
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    expect(framedRunReadinessIssue(currentCompletedFrame())).toBeNull();
  });
});

describe('every other jog still expires the Frame', () => {
  it('Current Position: any jog expires it, and Start sends nothing', async () => {
    const { sim } = await framed('current-position');
    const jogging = laser().jog({ dx: 30, dy: 20, feed: 1000 });
    await vi.advanceTimersByTimeAsync(20);
    expect(laser().motionOperation?.kind).toBe('jog');
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
    const from = sim.outbound().length;
    const repository = await startReviewedFrameOnClock();
    expect(sim.outbound().slice(from).join('')).not.toMatch(/\bM[34]\b/);
    expect(repository.getSnapshot().lastCompletedReceipt).toBeNull();
  });

  it.each(fixed)('%s: a Z jog expires it', async (mode) => {
    await framed(mode);
    const jogging = laser().jog({ dz: 2, feed: 500 });
    await vi.advanceTimersByTimeAsync(20);
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
  });

  it('a jog its owner had already cancelled before the Cancel expires it', async () => {
    await framed('absolute');
    const jogging = laser()
      .jog({ dx: 150, dy: 0, feed: 1000 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    const motion = laser().motionOperation;
    expect(motion?.heldFrame).toBeDefined();
    // As the phone remote does when its owner stops: mark, then ordinary Cancel.
    useLaserStore.setState({ motionOperation: { ...motion!, cancelRequested: true } });
    const cancelling = laser()
      .cancelJog()
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([jogging, cancelling]);
    expect(laser().motionOperation).toBeNull();
    expectFrameGone();
  });

  it('a rotary test turn, or any jog that asks to void the Frame, expires it', async () => {
    await framed('absolute');
    const jogging = laser().jog({ dx: 0, dy: 5, feed: 1000 }, undefined, { voidsFrame: true });
    await vi.advanceTimersByTimeAsync(20);
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
  });

  it('a jog that an alarm stops expires it', async () => {
    const { sim } = await framed('absolute');
    const jogging = laser()
      .jog({ dx: 150, dy: 0, feed: 1000 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(laser().motionOperation?.heldFrame).toBeDefined();
    // A limit switch: ALARM:1 ends the jog and voids the position.
    if (!('triggerAlarm' in sim)) throw new Error('Expected the GRBL simulator');
    sim.triggerAlarm(1);
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expect(laser().motionOperation).toBeNull();
    expectFrameGone();
    expect(laser().alarmCode).toBe(1);
  });

  it('a work origin that changes during the jog expires it at once', async () => {
    await framed('user-origin');
    const jogging = laser().jog({ dx: 150, dy: 0, feed: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    expect(laser().motionOperation?.heldFrame).toBeDefined();
    useLaserStore.setState({ wcoCache: { x: 101, y: 50, z: 0 } });
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    // Putting the offset back cannot return a Frame that already expired.
    useLaserStore.setState({ wcoCache: { x: 100, y: 50, z: 0 } });
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
    expect(frameExpiryReason()).toBe(CONTROLLER_CHANGED_AFTER_FRAME_REASON);
  });

  it('a work origin set after the jog expires the kept Frame', async () => {
    const { frame } = await framed('user-origin');
    await jogAndSettle({ dx: 10, dy: 10, feed: 1000 });
    expect(laser().completedFrame?.candidate).toBe(frame.candidate);
    const setting = laser().setOriginHere();
    await vi.advanceTimersByTimeAsync(3_000);
    await setting;
    expectFrameGone();
  });

  it.each([
    ['controller session', () => ({ controllerSessionEpoch: laser().controllerSessionEpoch + 1 })],
    ['position trust', () => ({ trustedPositionEpoch: (laser().trustedPositionEpoch ?? 0) + 1 })],
    ['Work Z reference', () => ({ workZReferenceEpoch: laser().workZReferenceEpoch + 1 })],
    ['work origin source', () => ({ workOriginSource: 'unknown' as const })],
  ])('a changed %s during the jog expires it', async (_name, patch) => {
    await framed('absolute');
    const jogging = laser()
      .jog({ dx: 150, dy: 0, feed: 1000 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(laser().motionOperation?.heldFrame).toBeDefined();
    useLaserStore.setState(patch());
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
  });

  it('an artwork edit made and undone during the jog expires it', async () => {
    await framed('absolute');
    const jogging = laser().jog({ dx: 150, dy: 0, feed: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    const original = useStore.getState().project;
    useStore.setState({
      project: {
        ...original,
        scene: {
          ...original.scene,
          objects: original.scene.objects.map((object) => ({
            ...object,
            transform: { ...object.transform, x: object.transform.x + 1 },
          })),
        },
      },
    });
    useStore.setState({ project: original });
    expect(laser().motionOperation?.heldFrame).toBeUndefined();
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
  });

  it('a placement changed to Current Position during the jog expires it', async () => {
    await framed('absolute');
    const jogging = laser().jog({ dx: 150, dy: 0, feed: 1000 });
    await vi.advanceTimersByTimeAsync(10);
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'front-left' } });
    await vi.advanceTimersByTimeAsync(3_000);
    await jogging;
    expectFrameGone();
  });

  it('a controller reset during the jog expires it', async () => {
    await framed('absolute');
    const jogging = laser()
      .jog({ dx: 150, dy: 0, feed: 1000 })
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10);
    expect(laser().motionOperation?.heldFrame).toBeDefined();
    const stopping = laser()
      .stopJob()
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.all([jogging, stopping]);
    expectFrameGone();
  });
});
