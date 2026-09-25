// Audit CG-4 repro: on a halted Smoothieware board the Frame/Start alarm fix
// offers Home, which the Smoothieware Home sequence is built to refuse.
//
// offerAlarmFixForBlockedStart() chooses Home whenever the profile has homing
// enabled (start-blocked-alarm-offers.ts), and the Alarm banner shows Home too.
// The Smoothieware driver's Home is `M400`, the fire-off lines, then `$H`, and
// starts with M400 precisely so that a halted board rejects it before `$H` (which
// would clear the halt itself) can run (smoothieware/driver.ts commands.home).
// Upstream, a halted kernel answers every G-code outside allowed_mcodes with `!!`
// (non-grbl mode) or `error:Alarm lock` (grbl mode): GcodeDispatch.cpp L34 and
// L158-L180. So the offered fix always fails with "Homing failed: !!", and the
// failed Home also raises a "Controller rejected a command" safety notice that
// the operator must acknowledge. Only M999 (Unlock) clears the halt.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L158-L180
//
// Correct behaviour: on a controller whose Home cannot run from its Alarm state,
// the in-place fix clears the alarm (M999) instead of offering a Home that is
// certain to be refused; no safety notice is raised for it.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';
import { offerAlarmFixForBlockedStart } from '../../ui/laser/start-blocked-alarm-offers';
import { ALARM_ACTIVE_START_MESSAGE } from '../../ui/laser/start-machine-refusals';
import { createUpstreamSmoothie } from './upstream-smoothie-fake';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(window, 'confirm').mockImplementation(() => true);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useLaserStore.setState({
    capabilities: grblDriver.capabilities,
    activeControllerKind: grblDriver.kind,
    connection: { kind: 'disconnected' },
    safetyNotice: null,
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
  for (let t = 0; t < 1_000 && !done; t += 1) await pump(10);
  return tracked;
}

describe('CG-4: alarm fix on a halted Smoothieware board', () => {
  it('clears the halt instead of offering a Home that the halted board refuses', async () => {
    const board = createUpstreamSmoothie();
    const device = useStore.getState().project.device;
    useStore.getState().updateDeviceProfile({
      controllerKind: 'smoothieware',
      homing: { ...device.homing, enabled: true },
    });
    await useLaserStore.getState().connect(board.adapter, { controllerKind: 'smoothieware' });
    await pump(2_500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    // Abort (Ctrl-X) halts a Smoothieware board even when it is idle.
    await settle(useLaserStore.getState().stopJob());
    await pump(2_000);
    expect(board.isHalted()).toBe(true);
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');
    useLaserStore.setState({ safetyNotice: null });

    await settle(offerAlarmFixForBlockedStart([ALARM_ACTIVE_START_MESSAGE]));
    await pump(2_000);

    // Fails today: the offer ran Home, whose first line M400 drew `!!`.
    expect(board.outbound()).not.toContain('M400\n');
    expect(board.isHalted()).toBe(false);
    expect(useLaserStore.getState().safetyNotice).toBeNull();
  });
});
