// Controller audit CG-3: Abort (Ctrl-X) halts Smoothieware; it does not reboot
// or print a banner. USBSerial sets halt_flag and on_idle prints `HALTED, M999
// or $X to exit HALT state` (`ALARM: Abort during cycle` in grbl mode), so the
// banner that re-arms qualification after a GRBL reset never comes. KerfDesk
// re-arms it after the reset write and runs it on the first Idle after the
// halt's Alarm, once the operator clears the halt with M999.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L204-L312

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await disconnectOnTestClock();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    pendingUntrackedAcks: 0,
    homingState: 'unknown',
    lastWriteError: null,
    safetyNotice: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function settle<T>(pending: Promise<T>): Promise<T> {
  let done = false;
  const tracked = pending.finally(() => {
    done = true;
  });
  for (let t = 0; t < 500 && !done; t += 1) await pump(10);
  return tracked;
}

async function connectSmoothie(grblMode = false): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator({ grblMode });
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  const connected = useLaserStore.getState();
  expect(connected.statusReport?.state).toBe('Idle');
  expect(connected.controllerQualification).toMatchObject({
    kind: 'qualified',
    epoch: connected.controllerSessionEpoch,
  });
  return sim;
}

describe('CG-3: Smoothieware qualification after Abort', () => {
  it.each([false, true])(
    'waits through the halt and re-qualifies after M999 (grbl mode %s)',
    async (grblMode) => {
      const sim = await connectSmoothie(grblMode);

      await settle(useLaserStore.getState().stopJob());
      await pump(2_000);
      expect(sim.outbound()).toContain('\x18');
      expect(sim.state().isHalted).toBe(true);
      const halted = useLaserStore.getState();
      expect(halted.statusReport?.state).toBe('Alarm');
      expect(halted.controllerQualification).toMatchObject({ kind: 'qualifying' });

      await settle(useLaserStore.getState().unlockAlarm());
      await pump(2_000);

      const after = useLaserStore.getState();
      expect(after.statusReport?.state).toBe('Idle');
      expect(after.pendingUntrackedAcks).toBe(0);
      expect(after.controllerQualification).toMatchObject({
        kind: 'qualified',
        epoch: after.controllerSessionEpoch,
      });
    },
  );
});
