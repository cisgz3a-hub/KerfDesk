// Audit SM-3 repro: `fire off` is never answered when Smoothieware's Laser
// module is not loaded, and KerfDesk owes it an acknowledgement forever.
//
// Correct behaviour: KerfDesk must not strand an owed acknowledgement on a line
// the firmware never answers. On a board whose Laser module is not loaded it
// should either refuse live laser work up front with the reason, or not send
// `fire off`; a jog must leave Jog/Frame/Home/Start usable.
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - Laser::on_module_loaded deletes the module when `laser_module_enable` is false
//   (src/modules/tools/laser/Laser.cpp L53-L57) or when the pin is not a hardware
//   PWM pin (L69-L74).
// - Only Laser::on_console_line_received answers `fire` (Laser.cpp L124-L179);
//   SimpleShell deliberately prints nothing for it (SimpleShell.cpp L286-L288),
//   and GcodeDispatch ignores every lowercase line (GcodeDispatch.cpp L79-L82).
//   So without the module `fire off` produces no output at all.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/laser/Laser.cpp#L51-L74
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L283-L295
//
// KerfDesk: every jog (commands.ts buildSmoothieJogCommand), Frame tool-off
// prefix, Home and job starts with `fire off`; safe-write reserves one owed ack
// per newline (laser-safe-write.ts owedTerminalAcks) and an owed ack never
// expires; only an Alarm report or a reboot banner clears the ledger, and a
// board without the Laser module is neither halted nor rebooting.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

const FIRE_OFF_COMPLETION = 'turning laser off and returning to auto mode';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await useLaserStore.getState().disconnect();
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

/** The simulator with the Laser module absent: identical except that nothing
 *  answers `fire off` (every other line, M221 included, still gets `ok`). */
async function connectSmoothieWithoutLaserModule(): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator();
  const port = sim.port as { emitLine: (line: string) => void };
  const emit = port.emitLine;
  port.emitLine = (line) => {
    if (line !== FIRE_OFF_COMPLETION) emit(line);
  };
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('SM-3: `fire off` on a board without the Laser module', () => {
  it('a jog leaves the controller usable (no acknowledgement owed forever)', async () => {
    const sim = await connectSmoothieWithoutLaserModule();
    await useLaserStore
      .getState()
      .jog({ dx: 5, feed: 1_000 })
      .catch(() => undefined);
    await pump(10_000);

    // The move itself ran: every other line was answered.
    expect(sim.state().pos.x).toBe(5);
    expect(sim.state().machine).toBe('Idle');

    // Fails today: one acknowledgement stays owed for the unanswered `fire off`,
    // so Home (and Jog/Frame/Start) are refused on an Idle machine until a
    // reconnect, and the next jog strands another one.
    const owed = useLaserStore.getState().pendingUntrackedAcks;
    const home = useLaserStore
      .getState()
      .home()
      .then(
        () => 'homed',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      );
    await pump(5_000);
    expect({ owed, home: await home }).toEqual({ owed: 0, home: 'homed' });
  });
});
