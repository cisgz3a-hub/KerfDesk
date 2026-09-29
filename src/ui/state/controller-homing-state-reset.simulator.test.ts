// Controller audit A-7 (ADR-375). Stock GRBL checks `$22`, then enters its
// homing state before it reads a `$H` suffix, and without
// HOMING_SINGLE_AXIS_COMMANDS (off by default, config.h:124) answers `$HX` with
// error:3 and never leaves that state. It reports Home, answers `$H` and `$J=`
// with error:8 and ignores `$X` until a soft reset, which raises ALARM:6:
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/system.c#L179-L194
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/motion_control.c#L380-L384
// KerfDesk offered no way out but Disconnect. The ADR-393 Reset offer now
// covers this state, and refuses nothing the controller would still take.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import { resetRequiredBlockMessage } from './controller-reset-required';
import { useLaserStore, type ConnectControllerOptions, type LaserState } from './laser-store';
import { resetStore } from './test-helpers';

// The Falcon command contract homes with `$HX` then `$HY`; on the stock GRBL
// driver that reaches a controller built without single-axis homing.
const STOCK_GRBL_FALCON_HOME: ConnectControllerOptions = {
  controllerKind: 'grbl-v1.1',
  controllerCommandSet: 'creality-falcon-a1-pro',
};
const STOCK_GRBL: ConnectControllerOptions = { controllerKind: 'grbl-v1.1' };

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  resetStore();
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

async function connectStockGrbl(
  options: ConnectControllerOptions,
  homingMs = 5,
): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ homingMs });
  await useLaserStore.getState().connect(sim.adapter, options);
  await vi.advanceTimersByTimeAsync(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

function outcomeOf(pending: Promise<unknown>): { value: string } {
  const outcome = { value: 'pending' };
  pending.then(
    () => (outcome.value = 'resolved'),
    (error: unknown) => (outcome.value = error instanceof Error ? error.message : String(error)),
  );
  return outcome;
}

function writesAfter(sim: GrblSimulator, count: number): string[] {
  return sim
    .outbound()
    .slice(count)
    .filter((data) => data !== '?');
}

describe('stock GRBL left in its homing state by a refused single-axis Home', () => {
  it('offers Reset after Home sends `$HX`, holds nothing new, and the reset recovers', async () => {
    const sim = await connectStockGrbl(STOCK_GRBL_FALCON_HOME);
    const home = outcomeOf(useLaserStore.getState().home());
    await vi.advanceTimersByTimeAsync(1_000);

    expect(home.value).toMatch(/error:3/);
    expect(sim.state()).toMatchObject({ machine: 'Home', homingStuck: true });
    const stuck = useLaserStore.getState();
    expect(stuck.statusReport?.state).toBe('Home');
    expect(stuck.resetRequired).toBe('homing-state');
    expect(stuck.log.some((line) => line.includes('stays in its homing state'))).toBe(true);

    // No new refusal: the critical-event gate stays open and the Console still
    // reaches the controller, which answers `$G` in this state.
    expect(resetRequiredBlockMessage(stuck)).toBeNull();
    const sent = sim.outbound().length;
    const modal = outcomeOf(useLaserStore.getState().sendConsoleCommand('$G'));
    await vi.advanceTimersByTimeAsync(200);
    expect(modal.value).toBe('resolved');
    expect(writesAfter(sim, sent)).toEqual(['$G\n']);

    // Reset (Ctrl-X): ALARM:6, the reboot banner ends the offer, and the
    // controller is locked in Alarm, where Unlock and Home are offered again.
    const reset = outcomeOf(useLaserStore.getState().wakeController());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reset.value).toBe('resolved');
    expect(sim.state().machine).toBe('Alarm');
    expect(useLaserStore.getState()).toMatchObject({ resetRequired: false, alarmCode: 6 });
    expect(useLaserStore.getState().statusReport?.state).toBe('Alarm');

    const unlock = outcomeOf(useLaserStore.getState().unlockAlarm());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(unlock.value).toBe('resolved');
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  });

  it('offers Reset after a Console `$HX` on the plain stock GRBL driver', async () => {
    const sim = await connectStockGrbl(STOCK_GRBL);
    const typed = outcomeOf(useLaserStore.getState().sendConsoleCommand('$HX'));
    await vi.advanceTimersByTimeAsync(1_000);

    expect(typed.value).not.toBe('pending');
    expect(sim.state().homingStuck).toBe(true);
    expect(useLaserStore.getState().statusReport?.state).toBe('Home');
    expect(useLaserStore.getState().resetRequired).toBe('homing-state');
  });

  it.each([
    ['the Home button', () => useLaserStore.getState().home()],
    ['a Console `$H`', () => useLaserStore.getState().sendConsoleCommand('$H')],
  ])('offers no Reset for the Home report that ends a cycle from %s', async (_label, start) => {
    const sim = await connectStockGrbl(STOCK_GRBL, 3_000);
    const offers: Array<LaserState['resetRequired']> = [];
    const unsubscribe = useLaserStore.subscribe((state) => offers.push(state.resetRequired));
    try {
      const homing = outcomeOf(start());
      await vi.advanceTimersByTimeAsync(6_000);
      expect(homing.value).toBe('resolved');
    } finally {
      unsubscribe();
    }

    // The `?` the cycle left unanswered came back as Home just before the `$H`
    // ok (motion_control.c:239), while that ok was still owed.
    const transcript = useLaserStore.getState().transcript;
    expect(transcript.some((entry) => entry.raw.startsWith('<Home|'))).toBe(true);
    expect(sim.state()).toMatchObject({ machine: 'Idle', isHomed: true });
    expect(offers).not.toContain('homing-state');
  });

  it('ends the offer when the controller reports any other state', async () => {
    await connectStockGrbl(STOCK_GRBL);
    useLaserStore.setState({ resetRequired: 'homing-state' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    expect(useLaserStore.getState().resetRequired).toBe(false);
  });
});
