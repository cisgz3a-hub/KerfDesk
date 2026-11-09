// Rolling audit v12 X1-P1-1, against the GRBL simulator with the real store and
// checkpoint tracker (after the refuter's power-cycle repro): a power-up or the
// reset a board does when its port opens re-zeroes machine position on a
// machine without homing, so the aborted job's saved origin (machine
// coordinates) no longer lands where the job ran. After one, Frame must not
// put it back: without homing it says so and offers only the origin at the
// head; with homing it homes first (ADR-341 Amendment 13). The Abort's own
// soft reset keeps machine position, and the offer still restores then.

import { describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { operatorAbortAlarm } from './abort-alarm-recovery';
import {
  connectSimulator,
  drive,
  harness,
  installRecoveryStressHooks,
  programLines,
  startFramedJob,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';
import { runFrameNow } from './use-frame-action';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 35, y: 15 };

function setHoming(enabled: boolean): void {
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: { ...project.device, homing: { ...project.device.homing, enabled } },
    },
    jobPlacement: { startFrom: 'user-origin', anchor: 'front-left' },
  });
}

/** Set the origin at ORIGIN, start a framed job, ABORT JOB, and leave the
 *  saved origin unrestored. */
async function abortWithUnrestoredOrigin(homing: boolean): Promise<StressHarness> {
  const h = await harness();
  setHoming(homing);
  if (homing) {
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
  const zeroBefore = useLaserStore.getState().machineZeroEpoch ?? 0;
  const { running } = await startFramedJob(h.repository);
  await tick(900);
  await drive(useLaserStore.getState().stopJob('operator'));
  await drive(running).catch(() => undefined);
  await tick(1_500);
  expect(operatorAbortAlarm(useLaserStore.getState())?.originAtStopMm).toEqual(ORIGIN);
  // The Abort's own soft reset (and its banner) keeps machine position.
  expect(useLaserStore.getState().machineZeroEpoch ?? 0).toBe(zeroBefore);
  return h;
}

/** Unlock from the Abort's alarm, as the rail's Unlock does, leaving the origin unrestored. */
async function unlock(): Promise<void> {
  await drive(useLaserStore.getState().unlockAlarm());
  await tick(1_500);
}

/** The laser is power-cycled: the link drops with the board, and the operator
 *  connects again to a controller whose machine zero is where the head stopped. */
async function powerCycle(h: StressHarness): Promise<void> {
  h.simulator.yankCable();
  await tick(2_000);
  h.simulator = await connectSimulator();
  await tick(2_000);
}

async function frameAndReadOffer(
  h: StressHarness,
  accept: boolean,
): Promise<{ readonly prompt: string; readonly g92: ReadonlyArray<string> }> {
  vi.mocked(jobAwareConfirm).mockClear().mockReturnValue(accept);
  const from = h.simulator.outbound().length;
  await drive(runFrameNow(), 60_000);
  return {
    prompt: String(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0] ?? ''),
    g92: programLines(h.simulator, from).filter((line) => line.includes('G92')),
  };
}

describe('X1-P1-1: the saved Abort origin after the controller restarted', () => {
  it(
    'without homing, after a power cycle, offers no restore and says the saved origin is gone',
    async () => {
      const h = await abortWithUnrestoredOrigin(false);
      await powerCycle(h);

      const declined = await frameAndReadOffer(h, false);
      expect(declined.prompt).toContain(
        'The job you stopped ran from X 35, Y 15 mm from machine zero, but the controller has ' +
          'restarted since then, and without homing its machine zero may have moved, so that ' +
          'origin cannot be put back.',
      );
      expect(declined.prompt).toContain('OK: set the work origin where the head is now.');
      expect(declined.prompt).not.toContain('put the saved origin back');
      expect(declined.g92).toEqual([]);

      // OK sets the origin at the head, as it says; it never writes the old one.
      const accepted = await frameAndReadOffer(h, true);
      expect(accepted.g92).toHaveLength(1);
      expect(accepted.g92[0]).not.toMatch(/X-35/);
      expect(totalWco(h.simulator.state())).not.toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'without homing, after a banner KerfDesk did not cause, offers no restore either',
    async () => {
      const h = await abortWithUnrestoredOrigin(false);
      await unlock();
      // A power-up on a board the USB link outlives: only the banner says so.
      h.simulator.port.emitLine("Grbl 1.1h ['$' for help]");
      await tick(3_000);

      const offer = await frameAndReadOffer(h, false);
      expect(offer.prompt).toContain('so that origin cannot be put back');
      expect(offer.g92).toEqual([]);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'with homing, after a power cycle, homes before it puts the saved origin back',
    async () => {
      const h = await abortWithUnrestoredOrigin(true);
      await powerCycle(h);

      const from = h.simulator.outbound().length;
      const offer = await frameAndReadOffer(h, true);
      expect(offer.prompt).toContain(
        'The controller has restarted since then, so its machine zero may have moved: Home ' +
          'measures it again before the origin goes back.',
      );
      expect(offer.prompt).toContain('OK: home the machine');
      expect(offer.prompt).not.toContain('The head is');
      const lines = programLines(h.simulator, from);
      const homed = lines.findIndex((line) => line.startsWith('$H'));
      const restored = lines.findIndex((line) => line.includes('G92'));
      expect(homed).toBeGreaterThanOrEqual(0);
      expect(restored).toBeGreaterThan(homed);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'in the same controller session the offer still restores the saved origin (control)',
    async () => {
      const h = await abortWithUnrestoredOrigin(false);
      await unlock();
      const offer = await frameAndReadOffer(h, true);
      expect(offer.prompt).toContain(
        'The job you stopped ran from X 35, Y 15 mm from machine zero, and that origin was not restored.',
      );
      expect(offer.g92).toHaveLength(1);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );
});
