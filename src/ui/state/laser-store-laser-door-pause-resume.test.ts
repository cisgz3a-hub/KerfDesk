// Laser Pause and Resume against what GRBL-family controllers actually report
// in their safety-door state. The oracle is the wire: whether KerfDesk sent a
// soft reset (0x18), whether it refilled the job, and what the operator sees.

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
  connectHarness,
  type ConnectionHarness,
  DOOR_AJAR_STATUS,
  drainPausedInFlight,
  EXPECTED_HEARTBEAT_TIMEOUT_MS,
  EXPECTED_MAX_TIMEOUT_MS,
  flushPromises,
  jobWriteCount,
  makeConnectionHarness,
  observeOutcome,
  PARKED_STATUS,
  PROGRESS_REPORT_INTERVAL_MS,
  RUN_STATUS,
} from '../../__fixtures__/controllers/cnc-pause-resume-store';
import { LASER_RESUME_DOOR_HELD_MESSAGE } from './laser-pause-resume-evidence';
import { useLaserStore } from './laser-store';
import { startTestLaserJob } from './laser-test-start-helpers';

const LASER_JOB = [
  'G21',
  'G90',
  'M8',
  'M4 S0',
  ...Array.from({ length: 30 }, (_, index) => `G1 X${index + 1} F3000 S300`),
  'M5',
  'M9',
].join('\n');
// grblHAL with its keep-coolant door option: laser off, M8 air still on.
const DOOR_AIR_ON_STATUS = '<Door:0|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:F>';
const DOOR_LASER_ON_STATUS = '<Door:0|MPos:4.000,0.000,0.000|FS:0,0|Ov:100,100,100|A:S>';
// Restore after cycle start: coolant (air) delay running, laser still dark.
const LASER_RESTORE_CASES = [
  { firmware: 'GRBL 1.1 / FluidNC', status: '<Door:3|MPos:4.000,0.000,0.000|FS:0,0|A:F>' },
  { firmware: 'grblHAL', status: '<Door:4|MPos:4.000,0.000,0.000|FS:0,0|A:F>' },
];
// A lid opened after Pause: same Door:1, with and without accessory data.
const DOOR_OPEN_CASES = [
  { label: 'with Ov:', status: DOOR_AJAR_STATUS },
  { label: 'sparse', status: '<Door:1|MPos:4.000,0.000,5.000|FS:0,0|Pn:D>' },
];
// A $393 coolant delay long enough to outlast the two-second heartbeat.
const LONG_COOLANT_RESTORE_MS = 3_100;

async function connectAndStartLaser(harness: ConnectionHarness): Promise<void> {
  await connectHarness(harness);
  useLaserStore.setState({
    controllerSettings: { laserModeEnabled: true },
    accessoryCache: { spindleCw: false, spindleCcw: false, flood: false, mist: false },
  });
  await startTestLaserJob(LASER_JOB);
  expect(useLaserStore.getState().activeJobMachineKind).toBe('laser');
  expect(useLaserStore.getState().streamer?.status).toBe('streaming');
}

async function pauseLaserAtDoor(harness: ConnectionHarness): Promise<void> {
  harness.setPauseStatus(PARKED_STATUS);
  await useLaserStore.getState().pauseJob();
  expect(useLaserStore.getState().streamer?.status).toBe('paused');
  // Free the RX window so Resume has a whole laser line to refill.
  await drainPausedInFlight(harness);
}

beforeEach(prepareCncPauseResumeTest);
afterEach(resetCncPauseResumeTest);

describe('laser Pause beam-off proof', () => {
  it('confirms a settled Door:0 while the controller keeps air assist on', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartLaser(harness);
    harness.setPauseStatus(DOOR_AIR_ON_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const observed = observeOutcome(useLaserStore.getState().pauseJob());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS);
    await flushPromises();

    expect(observed.result()).toBe('resolved');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);
    expect(useLaserStore.getState().streamer?.status).toBe('paused');
    expect(useLaserStore.getState().safetyNotice).toBeNull();
    expect(useLaserStore.getState().airAssistOn).toBe(true);
    expect(useLaserStore.getState().log.some((line) => line.includes('air assist still on'))).toBe(
      true,
    );
  });

  it('still fail-dark resets when the settled Door reports the laser output on', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartLaser(harness);
    harness.setPauseStatus(DOOR_LASER_ON_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const observed = observeOutcome(useLaserStore.getState().pauseJob());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).toContain(RT_SOFT_RESET);
  });
});

describe('laser Resume through the controller door-restore phase', () => {
  it.each(LASER_RESTORE_CASES)(
    'keeps Resume alive through a long $firmware restore, then refills after Run',
    async ({ status }) => {
      const harness = makeConnectionHarness();
      await connectAndStartLaser(harness);
      await pauseLaserAtDoor(harness);
      harness.setResumeStatus(status);
      harness.writes.length = 0;
      vi.useFakeTimers();

      const resume = useLaserStore.getState().resumeJob();
      const observed = observeOutcome(resume);
      await flushPromises();
      await advanceWithFreshStatus(harness, status, LONG_COOLANT_RESTORE_MS);

      expect(observed.result()).toBe('pending');
      expect(harness.writes).not.toContain(RT_SOFT_RESET);
      expect(jobWriteCount(harness.writes)).toBe(0);

      harness.emitStatus(RUN_STATUS);
      await resume;
      expect(observed.result()).toBe('resolved');
      expect(jobWriteCount(harness.writes)).toBeGreaterThan(0);
      expect(harness.writes).not.toContain(RT_SOFT_RESET);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    },
  );

  it('fail-dark resets once restore reports stop arriving', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartLaser(harness);
    await pauseLaserAtDoor(harness);
    const status = LASER_RESTORE_CASES[1]?.status ?? '';
    harness.setResumeStatus(status);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const observed = observeOutcome(useLaserStore.getState().resumeJob());
    await flushPromises();
    await advanceWithFreshStatus(harness, status, PROGRESS_REPORT_INTERVAL_MS * 2);
    harness.setStatusResponsesEnabled(false);
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).toContain(RT_SOFT_RESET);
    expect(jobWriteCount(harness.writes)).toBe(0);
  });

  it('bounds endless restore progress by the absolute transition maximum', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartLaser(harness);
    await pauseLaserAtDoor(harness);
    const status = LASER_RESTORE_CASES[1]?.status ?? '';
    harness.setResumeStatus(status);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const observed = observeOutcome(useLaserStore.getState().resumeJob());
    await flushPromises();
    await advanceWithFreshStatus(harness, status, EXPECTED_MAX_TIMEOUT_MS - BEFORE_DEADLINE_MS);
    expect(observed.result()).toBe('pending');
    expect(harness.writes).not.toContain(RT_SOFT_RESET);

    await vi.advanceTimersByTimeAsync(BEFORE_DEADLINE_MS);
    await flushPromises();
    expect(observed.result()).toBe('rejected');
    expect(harness.writes).toContain(RT_SOFT_RESET);
    expect(jobWriteCount(harness.writes)).toBe(0);
  });
});

describe('laser Resume while the door or lid input is open', () => {
  it.each(DOOR_OPEN_CASES)(
    'keeps the paused job when the controller keeps reporting Door:1 ($label)',
    async ({ status }) => {
      const harness = makeConnectionHarness();
      await connectAndStartLaser(harness);
      await pauseLaserAtDoor(harness);
      // The lid opens while paused; cycle start is then ignored, not queued.
      harness.emitStatus(status);
      harness.setResumeStatus(status);
      await flushPromises();
      harness.writes.length = 0;
      vi.useFakeTimers();

      const observed = observeOutcome(useLaserStore.getState().resumeJob());
      await flushPromises();
      await advanceWithFreshStatus(
        harness,
        status,
        EXPECTED_HEARTBEAT_TIMEOUT_MS + PROGRESS_REPORT_INTERVAL_MS,
      );

      expect(observed.result()).toBe('rejected');
      expect(harness.writes).toContain(RT_RESUME);
      expect(harness.writes).not.toContain(RT_SOFT_RESET);
      expect(jobWriteCount(harness.writes)).toBe(0);
      expect(useLaserStore.getState().streamer?.status).toBe('paused');
      expect(useLaserStore.getState().pauseResumeTransition).toBeNull();
      expect(useLaserStore.getState().safetyNotice?.message).toBe(LASER_RESUME_DOOR_HELD_MESSAGE);

      // Lid closed: the retry is an ordinary Resume.
      harness.emitStatus(PARKED_STATUS);
      harness.setResumeStatus(RUN_STATUS);
      await flushPromises();
      const retry = useLaserStore.getState().resumeJob();
      await flushPromises();
      await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_INTERVAL_MS);
      await retry;
      expect(jobWriteCount(harness.writes)).toBeGreaterThan(0);
      expect(harness.writes).not.toContain(RT_SOFT_RESET);
      expect(useLaserStore.getState().streamer?.status).toBe('streaming');
    },
  );

  it('still fail-dark resets when the controller goes silent after reporting Door:1', async () => {
    const harness = makeConnectionHarness();
    await connectAndStartLaser(harness);
    await pauseLaserAtDoor(harness);
    harness.setResumeStatus(DOOR_AJAR_STATUS);
    harness.writes.length = 0;
    vi.useFakeTimers();

    const observed = observeOutcome(useLaserStore.getState().resumeJob());
    await flushPromises();
    await vi.advanceTimersByTimeAsync(PROGRESS_REPORT_INTERVAL_MS);
    harness.setStatusResponsesEnabled(false);
    await vi.advanceTimersByTimeAsync(EXPECTED_HEARTBEAT_TIMEOUT_MS);
    await flushPromises();

    expect(observed.result()).toBe('rejected');
    expect(harness.writes).toContain(RT_SOFT_RESET);
  });
});
