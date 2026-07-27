import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RT_RESUME, RT_SOFT_RESET } from '../../core/controllers/grbl/commands';
import {
  prepareCncPauseResumeTest,
  resetCncPauseResumeTest,
} from '../../__fixtures__/controllers/cnc-pause-resume-lifecycle';
import {
  connectAndStartCnc,
  deferred,
  drainPausedInFlight,
  EXPECTED_HEARTBEAT_TIMEOUT_MS,
  flushPromises,
  HEALTHY_REFILL_WRITE_MS,
  jobWriteCount,
  makeConnectionHarness,
  observeOutcome,
  pauseAtSettledDoor,
  releaseHeldStreamCapacity,
  RUN_STATUS,
  SECOND_REFILL_WRITE_INDEX,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import { useLaserStore } from './laser-store';

const PENDING_TRANSPORT_MESSAGE = 'previous Pause or Resume transport write is still settling';
const REJECTED_TRANSPORT_MESSAGE = 'controller write was rejected with acceptance unknown';
const LATE_REFILL_REJECTION = 'late refill write rejected';
const EXPECTED_RESUME_ATTEMPTS = 2;

beforeEach(prepareCncPauseResumeTest);
afterEach(resetCncPauseResumeTest);

describe('CNC Resume refill ownership', () => {
  it('keeps a pending post-confirmation refill frozen across early and late acks', async () => {
    const harness = makeConnectionHarness();
    const refillWrite = deferred();
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    await releaseHeldStreamCapacity(harness);
    harness.setResumeStatus(RUN_STATUS);
    harness.setWriteOverride((data) =>
      data.includes('G1 X') ? refillWrite.promise : Promise.resolve(),
    );
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(observed.result()).toBe('pending');
    expect(useLaserStore.getState().pauseResumeTransition).toMatchObject({ action: 'resume' });
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    const jobWritesWhilePending = jobWriteCount(harness.writes);
    expect(jobWritesWhilePending).toBe(1);

    harness.connection.emitLine('ok');
    await flushPromises();
    expect(jobWriteCount(harness.writes)).toBe(jobWritesWhilePending);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('paused');

    const writesBeforeBlockedRetry = harness.writes.length;
    await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(PENDING_TRANSPORT_MESSAGE);
    expect(harness.writes).toHaveLength(writesBeforeBlockedRetry);

    refillWrite.resolve();
    await flushPromises();
    harness.connection.emitLine('ok');
    await flushPromises();

    expect(jobWriteCount(harness.writes)).toBe(jobWritesWhilePending);
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    harness.setWriteOverride(null);
    const retry = useLaserStore.getState().resumeJob();
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await retry;

    expect(harness.writes.filter((line) => line === RT_RESUME)).toHaveLength(
      EXPECTED_RESUME_ATTEMPTS,
    );
    expect(jobWriteCount(harness.writes)).toBeGreaterThan(jobWritesWhilePending);
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
  });

  it('contains a late rejected refill before retiring its retry fence', async () => {
    const harness = makeConnectionHarness();
    const refillWrite = deferred();
    const resetWrite = deferred();
    try {
      await connectAndStartCnc(harness);
      await pauseAtSettledDoor(harness);
      await releaseHeldStreamCapacity(harness);
      harness.setResumeStatus(RUN_STATUS);
      harness.setWriteOverride((data) => {
        if (data.includes('G1 X')) return refillWrite.promise;
        if (data === RT_SOFT_RESET) return resetWrite.promise;
        return Promise.resolve();
      });
      harness.writes.length = 0;
      vi.useFakeTimers();

      const resume = useLaserStore.getState().resumeJob();
      const observed = observeOutcome(resume);
      await flushPromises();
      await vi.advanceTimersByTimeAsync(0);
      await flushPromises();
      expect(jobWriteCount(harness.writes)).toBe(1);

      await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
      await flushPromises();
      expect(observed.result()).toBe('rejected');

      await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(PENDING_TRANSPORT_MESSAGE);

      refillWrite.reject(new Error(LATE_REFILL_REJECTION));
      await flushPromises();

      expect(useLaserStore.getState().streamer?.status).toBe('cancelled');
      expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('unavailable');
      expect(harness.writes).toContain(RT_SOFT_RESET);
      const writesBeforeRejectedRetry = harness.writes.length;

      await expect(useLaserStore.getState().resumeJob()).rejects.toThrow(
        REJECTED_TRANSPORT_MESSAGE,
      );
      expect(harness.writes).toHaveLength(writesBeforeRejectedRetry);
    } finally {
      refillWrite.resolve();
      resetWrite.resolve();
      await flushPromises();
      harness.connection.emitLine('Grbl 1.1f');
      await flushPromises();
    }
  });

  it('refreshes CNC liveness between healthy staged refills after an early ack', async () => {
    const harness = makeConnectionHarness();
    const firstRefillWrite = deferred();
    const secondRefillWrite = deferred();
    let refillWriteIndex = 0;
    await connectAndStartCnc(harness);
    await pauseAtSettledDoor(harness);
    await drainPausedInFlight(harness);
    harness.setResumeStatus(RUN_STATUS);
    harness.setWriteOverride((data) => {
      if (!data.includes('G1 X')) return Promise.resolve();
      refillWriteIndex += 1;
      if (refillWriteIndex === 1) return firstRefillWrite.promise;
      if (refillWriteIndex === SECOND_REFILL_WRITE_INDEX) return secondRefillWrite.promise;
      return Promise.resolve();
    });
    harness.writes.length = 0;
    vi.useFakeTimers();

    const resume = useLaserStore.getState().resumeJob();
    const observed = observeOutcome(resume);
    await flushPromises();
    await vi.advanceTimersByTimeAsync(0);
    await flushPromises();
    expect(jobWriteCount(harness.writes)).toBe(1);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    harness.connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(HEALTHY_REFILL_WRITE_MS);
    firstRefillWrite.resolve();
    await flushPromises();
    expect(jobWriteCount(harness.writes)).toBe(2);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');

    await vi.advanceTimersByTimeAsync(HEALTHY_REFILL_WRITE_MS);
    await flushPromises();
    expect(observed.result()).toBe('pending');

    secondRefillWrite.resolve();
    await flushPromises();
    await resume;

    expect(observed.result()).toBe('resolved');
    expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
    expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    expect(useLaserStore.getState().liveCanvasRun?.timing?.kind).toBe('running');
  });
});
