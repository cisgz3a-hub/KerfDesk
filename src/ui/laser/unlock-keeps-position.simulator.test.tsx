// User annoyance audit A1, A3-P2-1 (ADR-367 Amendment 3), against the GRBL
// simulator with the real store: Unlock hides the head position only when the
// alarm it clears can have lost it.
//  - A soft limit (ALARM:2) is raised after a controlled stop and keeps the
//    machine position through the reset it asks for, so after Reset and Unlock
//    the position and the offset the controller reports stay shown and Move to
//    position works. Stock GRBL clears a Set origin here origin at that reset;
//    grblHAL keeps it.
//  - A reset during motion (ALARM:3) cut the motors, so its Unlock hides them
//    as before, and Move to position names the way out.
// Firmware sources: src/core/controllers/grbl/alarm-position-kept.ts.

import { describe, expect, it, vi } from 'vitest';
import { totalWco } from '../../__fixtures__/controllers/grbl-sim-state';
import { useStore } from '../state';
import { jobAwareConfirm } from '../state/job-aware-dialogs';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { positionWithheldMessage } from './frame-position-withheld';
import { dispatchHeadMove } from './head-move-dispatch';
import { POSITION_KEPT_UNLOCK_OFFER_PROMPT } from './start-blocked-alarm-offers';
import {
  drive,
  frameUntilPermit,
  harness,
  installRecoveryStressHooks,
  STRESS_TIMEOUT_MS,
  tick,
  type StressHarness,
} from './recovery-stress-testing';

vi.mock('../state/job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));

installRecoveryStressHooks();

const ORIGIN = { x: 20, y: 30 };
const HEAD = { x: 25, y: 35 };
const GRBLHAL = {
  firmware: 'grblhal',
  firmwareBanner: "GrblHAL 1.1f ['$' or '$HELP' for help]",
} as const;

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

async function jogBy(dx: number, dy: number): Promise<void> {
  await drive(useLaserStore.getState().jog({ dx, dy, feed: 3_000 }));
  for (let step = 0; step < 100 && useLaserStore.getState().motionOperation !== null; step += 1) {
    await tick(100);
  }
  await tick(1_500);
}

/** Set origin here at ORIGIN, then leave the head at HEAD. */
async function originSetAndHeadMoved(): Promise<void> {
  await jogBy(ORIGIN.x, ORIGIN.y);
  await drive(useLaserStore.getState().setOriginHere());
  await tick(1_500);
  await jogBy(HEAD.x - ORIGIN.x, HEAD.y - ORIGIN.y);
}

/** A soft limit, then the Reset its Alarm card offers. */
async function softLimitThenReset(h: StressHarness): Promise<void> {
  h.simulator.triggerAlarm(2);
  await tick(1_500);
  expect(useLaserStore.getState()).toMatchObject({ alarmCode: 2, resetRequired: true });
  await drive(useLaserStore.getState().wakeController());
  await tick(1_500);
  // The same lock after the reset, and the head has not moved.
  expect(useLaserStore.getState()).toMatchObject({ alarmCode: 2, resetRequired: false });
  expect(h.simulator.state().machine).toBe('Alarm');
  expect(h.simulator.state().mpos).toMatchObject(HEAD);
}

async function unlock(): Promise<void> {
  await drive(useLaserStore.getState().unlockAlarm());
  await tick(1_500);
}

function unlockLogLine(): string {
  const lines = useLaserStore.getState().log.filter((line) => line.includes('Controller unlocked'));
  return lines.at(-1) ?? '';
}

/** Move to position, From origin X0 Y0, as its Go button sends it. */
async function goToWorkZero(): Promise<boolean> {
  const sent = dispatchHeadMove({ frame: 'origin', xMm: 0, yMm: 0 }, 'X0 Y0');
  for (let step = 0; step < 100 && useLaserStore.getState().motionOperation !== null; step += 1) {
    await tick(100);
  }
  await tick(1_500);
  return sent;
}

describe('A3-P2-1: Unlock after a soft limit keeps the position', () => {
  it(
    'stock GRBL: the position and the reported offset stay shown, and Move to position works',
    async () => {
      const h = await harness();
      setHoming(false);
      await originSetAndHeadMoved();
      await softLimitThenReset(h);
      // Stock GRBL's reset cleared the Set origin here origin (G92).
      expect(totalWco(h.simulator.state())).toMatchObject({ x: 0, y: 0 });

      await unlock();

      const laser = useLaserStore.getState();
      expect(laser.alarmCode).toBeNull();
      expect(laser.positionEvidenceSuppressed).not.toBe(true);
      expect(laser.statusReport).toMatchObject({ state: 'Idle', mPos: HEAD });
      // The offset the controller reports now, not a remembered one.
      expect(laser.wcoCache).toMatchObject({ x: 0, y: 0 });
      // Home and Frame evidence went, as after any Unlock.
      expect(laser).toMatchObject({ homingState: 'unknown', framedRun: null });
      expect(unlockLogLine()).toContain('after ALARM:2, which keeps the machine position');

      expect(await goToWorkZero()).toBe(true);
      expect(h.simulator.state().mpos).toMatchObject({ x: 0, y: 0 });
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'grblHAL: the Set origin here origin it keeps stays shown too',
    async () => {
      const h = await harness({ simulator: GRBLHAL });
      setHoming(false);
      await originSetAndHeadMoved();
      await softLimitThenReset(h);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);

      await unlock();

      const laser = useLaserStore.getState();
      expect(laser.positionEvidenceSuppressed).not.toBe(true);
      expect(laser.statusReport).toMatchObject({ state: 'Idle', mPos: HEAD });
      expect(laser.wcoCache).toMatchObject(ORIGIN);
      expect(laser.workOriginActive).toBe(true);

      expect(await goToWorkZero()).toBe(true);
      expect(h.simulator.state().mpos).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );

  it(
    'grblHAL: Frame offers that Unlock, says why, and frames from the kept origin',
    async () => {
      const h = await harness({ simulator: GRBLHAL });
      setHoming(false);
      await originSetAndHeadMoved();
      await softLimitThenReset(h);
      vi.mocked(jobAwareConfirm).mockClear();

      await frameUntilPermit();

      expect(vi.mocked(jobAwareConfirm).mock.calls[0]?.[0]).toBe(POSITION_KEPT_UNLOCK_OFFER_PROMPT);
      expect(useLaserStore.getState().positionEvidenceSuppressed).not.toBe(true);
      expect(totalWco(h.simulator.state())).toMatchObject(ORIGIN);
    },
    STRESS_TIMEOUT_MS,
  );
});

describe('A3-P2-1: Unlock after an alarm that loses position still hides it', () => {
  it(
    'a reset during motion (ALARM:3): hidden, and Move to position names the way out',
    async () => {
      const h = await harness();
      setHoming(false);
      await originSetAndHeadMoved();
      h.simulator.triggerAlarm(3);
      await tick(1_500);

      await unlock();

      const laser = useLaserStore.getState();
      expect(laser.positionEvidenceSuppressed).toBe(true);
      expect(laser.statusReport).toMatchObject({ state: 'Idle', mPos: null, wPos: null });
      expect(laser.wcoCache).toBeNull();
      expect(unlockLogLine()).toContain(
        'Position not kept: ALARM:3 is not known to keep the machine position',
      );

      useToastStore.setState({ toasts: [] });
      const sentFrom = h.simulator.outbound().length;
      expect(await goToWorkZero()).toBe(false);
      expect(useToastStore.getState().toasts.map((toast) => toast.message)).toEqual([
        positionWithheldMessage(laser, false),
      ]);
      expect(
        h.simulator
          .outbound()
          .slice(sentFrom)
          .some((data) => data.includes('$J=')),
      ).toBe(false);
      expect(h.simulator.state().mpos).toMatchObject(HEAD);
    },
    STRESS_TIMEOUT_MS,
  );

  // A power-up on a board the USB link outlives clears stock GRBL's machine
  // position; only its banner says so.
  it(
    'a soft limit followed by a restart KerfDesk did not send: hidden',
    async () => {
      const h = await harness();
      setHoming(false);
      await originSetAndHeadMoved();
      await softLimitThenReset(h);
      h.simulator.port.emitLine("Grbl 1.1h ['$' for help]");
      await tick(3_000);

      await unlock();

      expect(useLaserStore.getState().positionEvidenceSuppressed).toBe(true);
      expect(unlockLogLine()).toContain('Position not kept:');
    },
    STRESS_TIMEOUT_MS,
  );
});
