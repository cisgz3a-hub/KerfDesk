// Audit CG-9 repro: an auto-focus command that Smoothieware's shell answers
// without `ok` leaves its acknowledgement owed for the rest of the session.
//
// Auto-focus sends the profile's command verbatim as one owned line
// (autofocus-action.ts runAutofocus -> startControllerCommand); preflight only
// refuses an empty or multi-line command. It never runs the driver's Console
// policy, which on Smoothieware refuses exactly these lines
// (smoothieware/console-command.ts shellLineRefusal: "Smoothieware's shell
// answers <word> without an ok, so KerfDesk cannot tell when it has finished").
// safeWrite reserves one terminal ack per newline (laser-safe-write.ts
// owedTerminalAcks); the command's 15 s timer releases only the command owner
// (laser-interactive-command.ts finishControllerCommand), not the reservation.
//
// Upstream: GcodeDispatch ignores lines that start with `$` or a lowercase letter
// (GcodeDispatch.cpp L75-L82); SimpleShell runs them and prints `ok` only for
// $G, $#, $H and $X-while-halted; any other shell command prints its own text
// and never `ok` (SimpleShell.cpp L205-L297; `switch <name> on` prints
// "switch <name> set to: on", L1001-L1014).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/communication/GcodeDispatch.cpp#L75-L82
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L205-L297
//
// So after "Auto-focus timed out after 15s. The machine may still be moving",
// pendingUntrackedAcks stays 1 and every Jog, Frame, Home, origin action,
// Console line and Start is refused until Abort (an Alarm report clears the
// ledger) or a reconnect. Correct behaviour: a command the controller will never
// acknowledge is refused before it is sent (as the Console does), or at least
// does not leave the session wedged.
//
// Refutation controls (pass on current code): a comment-only auto-focus line is
// answered `ok` by Smoothieware (GcodeDispatch.cpp L467-L469), and on Marlin
// auto-focus never sends anything, because confirmFreshAutofocusIdle requires a
// realtime status query (autofocus-fresh-idle.ts) and Marlin has none.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator } from '../../__fixtures__/controllers';
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
  for (let t = 0; t < 2_500 && !done; t += 1) await pump(10);
  return tracked;
}

function outcome(pending: Promise<unknown>): Promise<string> {
  return pending.then(
    () => 'accepted',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

async function connectSmoothie(
  command: string,
): Promise<ReturnType<typeof createUpstreamSmoothie>> {
  const board = createUpstreamSmoothie();
  useStore.getState().updateDeviceProfile({
    controllerKind: 'smoothieware',
    autofocusCommand: command,
  });
  await useLaserStore.getState().connect(board.adapter, { controllerKind: 'smoothieware' });
  await pump(2_500);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return board;
}

describe('CG-9: auto-focus with a Smoothieware shell command', () => {
  it('does not leave an acknowledgement owed that blocks every later command', async () => {
    const board = await connectSmoothie('switch focus on');

    const result = await settle(useLaserStore.getState().autofocus('switch focus on'));
    // A minute of ordinary idle polling later nothing has released the ledger.
    await pump(60_000);
    expect(board.outbound()).toContain('switch focus on\n');
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');

    const jog = await settle(outcome(useLaserStore.getState().jog({ dx: 1, feed: 1000 })));
    const after = useLaserStore.getState();
    // Fails today: result {kind:'timeout'} ("the machine may still be moving"),
    // pendingUntrackedAcks 1 for good, and the jog is refused.
    expect(
      { result: result.kind, pendingUntrackedAcks: after.pendingUntrackedAcks, jog },
      JSON.stringify({ result, pendingUntrackedAcks: after.pendingUntrackedAcks, jog }),
    ).toMatchObject({ pendingUntrackedAcks: 0, jog: 'accepted' });
  });

  it('control: a comment-only auto-focus line is acknowledged by Smoothieware', async () => {
    const board = await connectSmoothie('; focus');
    const result = await settle(useLaserStore.getState().autofocus('; focus'));
    await pump(1_000);
    expect(board.outbound()).toContain('; focus\n');
    expect(result.kind).toBe('ok');
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });
});

describe('CG-9 refutation control: Marlin never sends the auto-focus command', () => {
  it('refuses at preflight because Marlin has no realtime status query', async () => {
    const sim = createMarlinSimulator();
    useStore
      .getState()
      .updateDeviceProfile({ controllerKind: 'marlin', autofocusCommand: '; focus' });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await pump(1_200);
    const result = await settle(useLaserStore.getState().autofocus('; focus'));
    expect(result).toMatchObject({
      kind: 'preflight-failed',
      reason: 'This controller cannot provide live status for auto-focus.',
    });
    expect(sim.outbound()).not.toContain('; focus\n');
  });
});
