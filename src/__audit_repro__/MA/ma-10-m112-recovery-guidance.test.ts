// Audit track MA (Marlin), finding MA-10: after a Console M112, KerfDesk tells
// the operator to reconnect (the quick command's hint) and then to "wait for
// Idle" (the controller-error notice). Marlin needs neither: it needs its
// RESET button, its KILL button, or a power cycle.
//
// KerfDesk: core/controllers/marlin/driver.ts L92-L96, the M112 quick command
// hint 'EMERGENCY STOP (halts firmware; reconnect required)'. After M112 the
// `Error:Printer halted. kill() called!` line becomes the generic
// controllerErrorNotice (ui/state/laser-safety-notice.ts) "... Check the Laser
// Log, wait for Idle, and home before continuing ...", and the next M114 poll
// is never answered, so the owed acknowledgement blocks every later command
// until Disconnect.
//
// Upstream (Marlin 2.1.2.8): M112 -> kill() (M108_M112_M410.cpp L42-L44, or at
// read time, queue.cpp L542) prints `echo:M112 Shutdown` and
// `Error:Printer halted. kill() called!` (MarlinCore.cpp L899, L910), then
// minkill() disables interrupts (L924 `cli(); // Stop interrupts`) and either
// waits for the KILL / encoder button and reboots (HAS_KILL or
// SOFT_RESET_ON_KILL, L941-L952) or spins forever (L956
// `for (;;) hal.watchdog_refresh();  // Wait for RESET button or power-cycle`).
// kill()'s own comment: "After this the machine will need to be reset."
// (L891). Closing and reopening the serial port resets the board only where
// the USB-serial hardware pulses reset on port open (DTR auto-reset, e.g. an
// ATmega2560 board); nothing in Marlin does it, and a native-USB board whose
// interrupts are off cannot even enumerate again until it is reset.
// bugfix-2.1.x (3b2b9ca6) is the same (MarlinCore.cpp L921, L954, L986).
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/MarlinCore.cpp#L889-L957
//
// Correct behaviour: the M112 guidance says the controller must be reset (its
// reset button or a power cycle) before reconnecting, and the notice after
// `kill() called!` does not ask the operator to wait for an Idle report the
// halted board can never send.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { marlinDriver } from '../../core/controllers/marlin/driver';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    detectedControllerKind: null,
    connection: { kind: 'disconnected' },
    statusReport: null,
    safetyNotice: null,
    motionOperation: null,
    controllerOperation: null,
    streamer: null,
    log: [],
    transcript: [],
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('MA-10: Marlin M112 recovery guidance', () => {
  it('the M112 quick command says the board must be reset or power-cycled', () => {
    const m112 = marlinDriver.consoleQuickCommands.find((entry) => entry.command === 'M112');
    // Current code: 'EMERGENCY STOP (halts firmware; reconnect required)'.
    expect(m112?.hint).toMatch(/reset|power/i);
  });

  it('after kill() the notice does not ask the operator to wait for Idle', async () => {
    const sim = createMarlinSimulator();
    useStore.getState().updateDeviceProfile({ controllerKind: 'marlin' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1_200);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    await useLaserStore
      .getState()
      .sendConsoleCommand('M112')
      .catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sim.state().isHalted).toBe(true);

    const notice = useLaserStore.getState().safetyNotice;
    const raw = notice !== null && 'raw' in notice ? notice.raw : undefined;
    expect(raw ?? '').toContain('kill() called');
    // Current code: "... Check the Laser Log, wait for Idle, and home ...".
    expect(notice?.message ?? '').not.toMatch(/wait for Idle/i);
    expect(notice?.message ?? '').toMatch(/reset|power/i);
  });
});
