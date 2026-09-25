// Audit SM-6 repro: Home is confirmed on a Smoothieware board where `$H` ran
// no homing cycle.
//
// Correct behaviour: KerfDesk must not record a confirmed Home unless the
// controller actually re-referenced the axes. On Smoothieware `$H` prints `ok`
// whether or not anything homed, so the `ok` plus a later Idle is not proof.
// Smoothieware can say whether the axes are homed: `G28.6` prints `X:1 Y:1 `
// (Endstops.cpp L1114-L1120, present since fdfa00d2, 2016-10-01) and prints
// nothing when no homing endstop exists; the `?` report shows `Home` only while
// Endstops runs a cycle (Kernel.cpp L181-L196).
//
// Upstream evidence (Smoothieware edge 38e2cc08):
// - SimpleShell `$H` dispatches G28 (or G28.2 in grbl mode) and then prints `ok`
//   unconditionally (src/modules/utils/simpleshell/SimpleShell.cpp L241-L252).
// - Endstops::on_module_loaded deletes itself when no endstop is configured
//   (src/modules/tools/endstops/Endstops.cpp L114-L129), so nothing handles G28;
//   when the module loads without homing pins, process_home_command prints
//   `WARNING: Nothing to home` and returns (Endstops.cpp L849-L852).
// - Robot has no G28 handler, so the position is unchanged.
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/utils/simpleshell/SimpleShell.cpp#L241-L252
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L114-L129
//
// GRBL refuses `$H` when homing is disabled (error:5), which KerfDesk treats as
// a refused Home; Smoothieware gives no such answer.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
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
    connection: { kind: 'disconnected' },
    statusReport: null,
    motionOperation: null,
    controllerOperation: null,
    homingState: 'unknown',
    homingProof: null,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** The simulator with no Endstops module: `$H` is answered `ok` at once and
 *  nothing moves. Every other line behaves as before. */
async function connectSmoothieWithoutEndstops(): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator();
  const connection = sim.port.connection as { write: (data: string) => Promise<void> };
  const write = connection.write;
  connection.write = async (data) => {
    if (data !== '$H\n') return write(data);
    setTimeout(() => sim.port.emitLine('ok'), 1);
  };
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('SM-6: Home on a Smoothieware board whose `$H` homes nothing', () => {
  it('is not recorded as a confirmed Home', async () => {
    const sim = await connectSmoothieWithoutEndstops();
    await useLaserStore.getState().jog({ dx: 40, dy: 25, feed: 3_000 });
    await pump(900);

    const homing = useLaserStore.getState().home();
    await pump(3_000);
    await homing.catch(() => undefined);

    // Nothing homed: the head is where the jog left it.
    expect(sim.state()).toMatchObject({ homingCycles: 0, pos: { x: 40, y: 25 } });
    // Fails today: 'confirmed', with a homing proof bound to this session.
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
  });
});
