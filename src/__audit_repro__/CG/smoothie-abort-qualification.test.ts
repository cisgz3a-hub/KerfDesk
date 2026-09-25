// Audit CG-3 repro: after Abort (Ctrl-X) on Smoothieware the controller
// qualification stays "Controller reset detected. Waiting for fresh Idle before
// reading settings…" for the rest of the session.
//
// Abort writes the driver's softReset byte and applies
// invalidateControllerSessionEvidence(), which moves the session epoch and sets
// controllerQualification = qualifying('reset-cleanup'). For the GRBL family the
// reboot banner that follows a soft reset runs handleWelcomeLine ->
// scheduleControllerQualification(), which re-qualifies on the next fresh Idle.
// Smoothieware never reboots on Ctrl-X: SerialConsole/USBSerial set halt_flag,
// on_idle calls ON_HALT (Kernel::call_event sets halted = true) and prints
// "ALARM: Abort during cycle" in grbl mode or "HALTED, M999 or $X to exit HALT
// state" otherwise. No banner is printed, so nothing ever schedules qualification.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/SerialConsole.cpp#L199-L245
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/USBDevice/USBSerial/USBSerial.cpp#L204-L312
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/libs/Kernel.cpp#L359-L385
// (The repo's smoothie-simulator.ts instead answers Ctrl-X with a `Smoothie`
// banner and halts only when moving, which hides this path.)
//
// Correct behaviour: once the operator clears the halt with M999 and the
// controller reports fresh Idle, the session is qualified again (Smoothieware
// needs no settings read), as it is after connect. Supervised recovery
// (requireFreshControllerQualification in start-job-source.ts) and the
// ConnectionBar depend on it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { createUpstreamSmoothie } from './upstream-smoothie-fake';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
  });
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
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

describe('CG-3: Smoothieware Abort leaves qualification pending forever', () => {
  it('re-qualifies after Abort, M999 and a fresh Idle report', async () => {
    const port = createUpstreamSmoothie();
    useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
    await useLaserStore.getState().connect(port.adapter, { controllerKind: 'smoothieware' });
    await pump(2_500);
    const connected = useLaserStore.getState();
    expect(connected.statusReport?.state).toBe('Idle');
    expect(connected.controllerQualification).toMatchObject({
      kind: 'qualified',
      epoch: connected.controllerSessionEpoch,
    });

    await settle(useLaserStore.getState().stopJob());
    await pump(2_000);
    expect(port.outbound()).toContain('\x18');
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

    await settle(useLaserStore.getState().unlockAlarm());
    await pump(10_000);
    const after = useLaserStore.getState();
    expect(after.statusReport?.state).toBe('Idle');
    expect(after.pendingUntrackedAcks).toBe(0);

    // Fails today: { kind: 'qualifying', phase: 'reset-cleanup' } for good,
    // shown as "Controller reset detected. Waiting for fresh Idle before
    // reading settings…" and refusing supervised recovery.
    expect(after.controllerQualification, JSON.stringify(after.controllerQualification)).toMatchObject({
      kind: 'qualified',
      epoch: after.controllerSessionEpoch,
    });
  });
});
