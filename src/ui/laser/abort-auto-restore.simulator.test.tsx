// User annoyance audit A1, finding A3-D-1 (ADR-341 Amendment 14), against the
// GRBL simulator with the real store, checkpoint tracker, Frame and Abort.
//
// After ABORT JOB on a laser without homing, the origin the reset cleared goes
// back by itself: the controller ends Idle with the work offset the job ran
// with, one toast says the job was stopped, and nothing sent after the reset
// moves the head or switches the beam on. Start still needs a new Frame. The
// twins keep the "You stopped the job" card and send nothing: a profile with
// homing, a CNC job, and a machine zero that may have moved.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { operatorAbortAlarm } from './abort-alarm-recovery';
import { ABORT_ORIGIN_RESTORED_MESSAGE, installAbortAutoRestore } from './abort-auto-restore';
import {
  drive,
  frameUntilPermit,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

let uninstall = (): void => undefined;
afterEach(() => {
  uninstall();
  uninstall = (): void => undefined;
});

const ORIGIN = { x: 20, y: 30 };
const SOFT_RESET = String.fromCharCode(0x18);
// Anything that moves an axis or can light the beam.
const MOTION_OR_BEAM = /^\$J=|^\$H|\bG0?[0-3]\b|\bG38|\bG28|\bG30|\bM0?[34]\b|\bS0*[1-9]/;

function setHoming(enabled: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled } },
    },
  });
}

type Aborted = {
  readonly h: StressHarness;
  readonly runId: string;
  /** Lines written after the Abort's reset byte, realtime bytes removed. */
  readonly sentAfterReset: () => ReadonlyArray<string>;
};

/** Set the origin, Frame, Start, and press ABORT JOB mid-job, with the
 *  automatic restore installed as App installs it. `beforeAbort` runs while
 *  the job streams. */
async function abortRunningJob(
  options: { readonly homing?: boolean; readonly beforeAbort?: () => void } = {},
): Promise<Aborted> {
  const h = await harness();
  uninstall = installAbortAutoRestore();
  useStore.setState({ jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' } });
  if (options.homing === true) {
    setHoming(true);
    await drive(useLaserStore.getState().home(), 30_000);
    await tick(1_500);
  }
  await drive(useLaserStore.getState().jog({ dx: ORIGIN.x, dy: ORIGIN.y, feed: 3_000 }));
  for (let step = 0; step < 100 && useLaserStore.getState().motionOperation !== null; step += 1) {
    await tick(100);
  }
  await tick(1_500);
  await drive(useLaserStore.getState().setOriginHere());
  await tick(1_500);
  expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
  const { runId, running } = await startFramedJob(h.repository);
  await tick(600);
  options.beforeAbort?.();
  useToastStore.setState({ toasts: [] });
  const from = h.simulator.outbound().length;
  await drive(useLaserStore.getState().stopJob('operator'));
  await drive(running).catch(() => undefined);
  const sentAfterReset = (): ReadonlyArray<string> => {
    const writes = h.simulator.outbound();
    const reset = writes.findIndex((write, index) => index >= from && write.includes(SOFT_RESET));
    expect(reset).toBeGreaterThanOrEqual(from);
    return programLines(h.simulator, reset + 1);
  };
  return { h, runId, sentAfterReset };
}

function restoredToasts(): ReadonlyArray<string> {
  return useToastStore
    .getState()
    .toasts.map((toast) => toast.message)
    .filter((message) => message === ABORT_ORIGIN_RESTORED_MESSAGE);
}

function unlockOrOriginWrites(lines: ReadonlyArray<string>): ReadonlyArray<string> {
  return lines.filter((line) => line.startsWith('$X') || line.includes('G92'));
}

/** The card is as the Abort left it: ALARM:3, the origin cleared, nothing sent
 *  to unlock or to write an origin, and no restore announced. */
function expectCardUntouched(aborted: Aborted): void {
  const laser = useLaserStore.getState();
  expect(laser.alarmCode).toBe(3);
  expect(laser.statusReport?.state).toBe('Alarm');
  expect(operatorAbortAlarm(laser)?.originAtStopMm).toEqual(ORIGIN);
  expect(totalWco(aborted.h.simulator.state())).toMatchObject({ x: 0, y: 0 });
  const sent = aborted.sentAfterReset();
  expect(unlockOrOriginWrites(sent)).toEqual([]);
  expect(sent.filter((line) => MOTION_OR_BEAM.test(line))).toEqual([]);
  expect(restoredToasts()).toEqual([]);
}

describe('A3-D-1: after ABORT JOB on a laser without homing', () => {
  it(
    'puts the origin back by itself, ends Idle, says so once, and moves nothing',
    async () => {
      const aborted = await abortRunningJob();
      const { h } = aborted;
      // The reset stopped the head and cleared the origin; the alarm stands.
      await tick(300);
      expect(useLaserStore.getState().alarmCode).toBe(3);
      expect(totalWco(h.simulator.state())).toMatchObject({ x: 0, y: 0 });
      const stoppedAt = h.simulator.state().mpos;

      await tick(6_000);
      const laser = useLaserStore.getState();
      expect(laser.alarmCode).toBeNull();
      expect(laser.statusReport?.state).toBe('Idle');
      // The same work offset as before the job, in the controller and the app.
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
      expect(laser).toMatchObject({
        workOriginActive: true,
        workOriginSource: 'g92',
        positionEvidenceSuppressed: false,
      });
      expect(restoredToasts()).toHaveLength(1);

      // After the reset: the cleanup, one Unlock, one G92. No motion, no beam.
      const sent = aborted.sentAfterReset();
      const writes = unlockOrOriginWrites(sent);
      expect(writes).toHaveLength(2);
      expect(writes[0]).toBe('$X');
      expect(writes[1]).toMatch(/^G54 G21 G92 X-?\d+\.\d{3} Y-?\d+\.\d{3}$/);
      expect(sent.filter((line) => MOTION_OR_BEAM.test(line))).toEqual([]);
      expect(h.simulator.state().mpos).toEqual(stoppedAt);

      // The stop is not hidden: the interrupted job keeps its record, and no
      // Frame evidence or Start permit came back with the origin.
      expect(h.repository.getSnapshot().recoveryCapsule?.runId).toBe(aborted.runId);
      expect(laser.framedRun).toBeNull();
      expect(laser.completedFrame).toBeNull();
      expect(laser.frameVerification).toBeNull();

      // Once only: a long wait sends nothing more, and the next Frame runs
      // from the restored origin.
      const quietFrom = h.simulator.outbound().length;
      await tick(15_000);
      expect(unlockOrOriginWrites(programLines(h.simulator, quietFrom))).toEqual([]);
      expect(restoredToasts()).toEqual([]);
      await frameUntilPermit();
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('A3-D-1 twins: the card stays, and nothing is sent', () => {
  it(
    'on a profile with homing, where the restore would home first',
    async () => {
      const aborted = await abortRunningJob({ homing: true });
      await tick(8_000);
      expectCardUntouched(aborted);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'for a CNC job, whose work Z must be zeroed again',
    async () => {
      // The job's kind as a CNC Start records it; the stop request keeps it.
      const aborted = await abortRunningJob({
        beforeAbort: () => useLaserStore.setState({ activeJobMachineKind: 'cnc' }),
      });
      expect(useLaserStore.getState().jobStopRequest?.jobMachineKind).toBe('cnc');
      await tick(8_000);
      expectCardUntouched(aborted);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'when machine zero may have moved since the Abort read the origin',
    async () => {
      const aborted = await abortRunningJob();
      expect(useLaserStore.getState().jobStopRequest?.jobMachineKind).toBe('laser');
      // What a reconnect or a restart KerfDesk did not send records (ADR-341
      // Amendment 13), while the Abort's alarm still stands.
      useLaserStore.setState((state) => ({
        machineZeroEpoch: (state.machineZeroEpoch ?? 0) + 1,
      }));
      await tick(8_000);
      expectCardUntouched(aborted);
    },
    STRESS_TIMEOUT_MS,
  );
});
