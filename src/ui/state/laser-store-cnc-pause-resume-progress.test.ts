import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_RESUME } from '../../core/controllers/grbl';
import { RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import {
  prepareCncPauseResumeTest,
  resetCncPauseResumeTest,
} from '../../__fixtures__/controllers/cnc-pause-resume-lifecycle';
import {
  advanceWithFreshStatus,
  BEFORE_DEADLINE_MS,
  connectAndStartCnc,
  deferred,
  DOOR_AJAR_STATUS,
  EXPECTED_HEARTBEAT_TIMEOUT_MS,
  EXPECTED_MAX_TIMEOUT_MS,
  flushPromises,
  jobWriteCount,
  LONG_RESTORE_PROGRESS_MS,
  makeConnectionHarness,
  observeOutcome,
  PARKED_STATUS,
  PARKING_STATUS,
  pauseAtSettledDoor,
  PROGRESS_REPORT_INTERVAL_MS,
  releaseHeldStreamCapacity,
  RESTORING_STATUS,
  RUN_STATUS,
  STATUS_QUERY,
  STOCK_PARKING_PROGRESS_MS,
  STOCK_SPINDLE_RESTORE_PROGRESS_MS,
  WRONG_DIRECTION_PROGRESS_CASES,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import { CNC_PAUSE_RESUME_STALLED_MESSAGE } from './laser-safety-notice';
import { useLaserStore } from './laser-store';

const PENDING_TRANSPORT_MESSAGE = 'previous Pause or Resume transport write is still settling';

beforeEach(prepareCncPauseResumeTest);
afterEach(resetCncPauseResumeTest);

describe('CNC Pause and Resume progress-aware deadlines', () => {
  it('keeps Pause alive through stock Door:2 parking before settled Door:0', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    harness.setPauseStatus(PARKING_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const pause = useLaserStore.getState().pauseJob();
    const observed = observeOutcome(pause);
    await flushPromises();
    expect(useLaserStore.getState().pauseResumeTransition).toMatchObject({ action: 'pause' });
    await advanceWithFreshStatus(harness, PARKING_STATUS, STOCK_PARKING_PROGRESS_MS);

    expect(observed.result()).toBe('pending');
    expect(useLaserStore.getState().statusReport).toMatchObject({ state: 'Door', subState: 2 });
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('paused');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);

    harness.emitStatus(PARKED_STATUS);
    await pause;
    expect(observed.result()).toBe('resolved');
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('keeps Resume alive through stock Door:3 restore and refills exactly once after Run', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    await releaseHeldStreamCapacity(harness);
    harness.setResumeStatus(RESTORING_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    expect(useLaserStore.getState().pauseResumeTransition).toMatchObject({ action: 'resume' });
    await advanceWithFreshStatus(harness, RESTORING_STATUS, STOCK_SPINDLE_RESTORE_PROGRESS_MS);

    expect(observed.result()).toBe('pending');
    expect(useLaserStore.getState().statusReport).toMatchObject({ state: 'Door', subState: 3 });
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('paused');
    expect(jobWriteCount(harness.writes)).toBe(0);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);

    harness.emitStatus(RUN_STATUS);
    await resume;
    expect(observed.result()).toBe('resolved');
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(harness.writes.filter((line) => line === RT_RESUME)).toHaveLength(1);
    expect(jobWriteCount(harness.writes)).toBe(1);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('running');

    harness.emitStatus(RUN_STATUS);
    await flushPromises();
    expect(jobWriteCount(harness.writes)).toBe(1);
  });

  it('keeps a longer live Door:3 restore pending beyond the old eight-second status wait', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    await releaseHeldStreamCapacity(harness);
    harness.setResumeStatus(RESTORING_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await advanceWithFreshStatus(harness, RESTORING_STATUS, LONG_RESTORE_PROGRESS_MS);

    expect(observed.result()).toBe('pending');
    expect(jobWriteCount(harness.writes)).toBe(0);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);

    harness.emitStatus(RUN_STATUS);
    await resume;
    expect(observed.result()).toBe('resolved');
    expect(jobWriteCount(harness.writes)).toBe(1);
  });

  it('still rejects after two seconds of controller-status silence', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    harness.setStatusResponsesEnabled(false);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(observed.error()).toBeInstanceOf(Error);
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().safetyNotice).toEqual({
      kind: 'stream-stalled',
      message: CNC_PAUSE_RESUME_STALLED_MESSAGE,
    });
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(jobWriteCount(harness.writes)).toBe(0);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('does not treat fresh Door:1 reports as Resume progress', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    harness.setResumeStatus(DOOR_AJAR_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await advanceWithFreshStatus(
      harness,
      DOOR_AJAR_STATUS,
      EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS,
    );

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(jobWriteCount(harness.writes)).toBe(0);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it.each(WRONG_DIRECTION_PROGRESS_CASES)(
    'does not treat the opposite Door substate as $action progress',
    async ({ action, status }) => {
      const harness = makeConnectionHarness();
      await connectAndStartCnc(harness);
      if (action === 'resume') {
        await pauseAtSettledDoor(harness);
        harness.setResumeStatus(status);
      } else {
        harness.setPauseStatus(status);
      }
      harness.writes.length = 0;
      vi.useFakeTimers();

      const transition =
        action === 'pause'
          ? useLaserStore.getState().pauseJob()
          : useLaserStore.getState().resumeJob();
      const observed = observeOutcome(transition);
      await flushPromises();
      await advanceWithFreshStatus(
        harness,
        status,
        EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS,
      );

      expect(observed.result()).toBe('rejected');
      expect(harness.writes).not.toContain(RT_SOFT_RESET);
      expect(jobWriteCount(harness.writes)).toBe(0);
      expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
      expect(useLaserStore.getState().streamer?.status).toBe('paused');
    },
  );

  it('lets a fresh retry own confirmation and refill after a CNC silence timeout', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    await releaseHeldStreamCapacity(harness);
    harness.setStatusResponsesEnabled(false);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const firstResume = useLaserStore.getState().resumeJob();
    const firstOutcome = observeOutcome(firstResume);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    await flushPromises();
    expect(firstOutcome.result()).toBe('rejected');

    harness.setStatusResponsesEnabled(true);
    const retry = useLaserStore.getState().resumeJob();
    await flushPromises();
    harness.emitStatus(RUN_STATUS);
    await retry;

    expect(harness.writes.filter((line) => line === RT_RESUME)).toHaveLength(2);
    expect(jobWriteCount(harness.writes)).toBe(1);
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('bounds endless fresh Door:3 progress without resetting or refilling', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    harness.setResumeStatus(RESTORING_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await advanceWithFreshStatus(
      harness,
      RESTORING_STATUS,
      EXPECTED_MAX_TIMEOUT_MS - BEFORE_DEADLINE_MS,
    );

    expect(observed.result()).toBe('pending');
    expect(jobWriteCount(harness.writes)).toBe(0);
    await vi.advanceTimersByTimeAsync(BEFORE_DEADLINE_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(observed.error()).toBeInstanceOf(Error);
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(jobWriteCount(harness.writes)).toBe(0);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });

  it('does not let Door progress extend a hung status-query transport write', async () => {
    const harness = makeConnectionHarness();
    const statusQueryWrite = deferred();
    await connectAndStartCnc(harness);
    harness.setPauseStatus(PARKING_STATUS);
    harness.setWriteOverride((data) =>
      data === STATUS_QUERY ? statusQueryWrite.promise : Promise.resolve(),
    );
    harness.writes.length = 0;
    vi.useFakeTimers();

    const pause = useLaserStore.getState().pauseJob();
    const observed = observeOutcome(pause);
    await flushPromises();
    expect(useLaserStore.getState().pauseResumeTransition).toMatchObject({ action: 'pause' });
    await advanceWithFreshStatus(
      harness,
      PARKING_STATUS,
      EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS,
    );

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(useLaserStore.getState().pauseResumeTransition).toMatchObject({ action: 'pause' });
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    const writesAfterTimeout = harness.writes.length;

    await expect(useLaserStore.getState().pauseJob()).rejects.toThrow(PENDING_TRANSPORT_MESSAGE);
    expect(harness.writes).toHaveLength(writesAfterTimeout);

    statusQueryWrite.resolve();
    await flushPromises();
    expect(harness.writes).toHaveLength(writesAfterTimeout);
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
  });
});
