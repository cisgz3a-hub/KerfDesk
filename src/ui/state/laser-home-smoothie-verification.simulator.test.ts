// Controller audit SM-6: Smoothieware answers `$H` with `ok` whether or not
// anything homed (SimpleShell.cpp L241-L252 at edge 38e2cc08), so KerfDesk asks
// `G28.6` which axes are homed before it confirms a Home. G28.6 prints
// `X:1 Y:1 ` for each axis with a homing pin (Endstops.cpp L1114-L1120) and
// nothing when the Endstops module deleted itself (Endstops.cpp L114-L129).
// https://github.com/Smoothieware/Smoothieware/blob/38e2cc083db0e4f768535a9bf2d32cdf104ea980/src/modules/tools/endstops/Endstops.cpp#L1114-L1120

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSmoothieSimulator,
  type CreateSmoothieSimulatorOptions,
  type SmoothieSimulator,
} from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

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
    homingProof: null,
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

async function connectSmoothie(
  options: CreateSmoothieSimulatorOptions = {},
): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator(options);
  useStore.getState().updateDeviceProfile({ controllerKind: 'smoothieware' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

async function homeOutcome(): Promise<string> {
  const outcome = useLaserStore
    .getState()
    .home()
    .then(
      () => 'homed',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
  await pump(5_000);
  return outcome;
}

describe('SM-6: a Smoothieware Home is confirmed only when G28.6 reports X and Y homed', () => {
  it('confirms a Home the Endstops module ran, after asking G28.6', async () => {
    const sim = await connectSmoothie();

    expect(await homeOutcome()).toBe('homed');

    const outbound = sim.outbound();
    expect(outbound.indexOf('G28.6\n')).toBeGreaterThan(outbound.indexOf('$H\n'));
    expect(sim.state()).toMatchObject({ homingCycles: 1, isHomed: true });
    expect(useLaserStore.getState()).toMatchObject({
      homingState: 'confirmed',
      pendingUntrackedAcks: 0,
    });
  });

  it('does not confirm a Home on a board without the Endstops module', async () => {
    const sim = await connectSmoothie({ endstops: false });
    await useLaserStore.getState().jog({ dx: 40, dy: 25, feed: 3_000 });
    await pump(900);

    const outcome = await homeOutcome();

    // Nothing homed: the head is where the jog left it.
    expect(sim.state()).toMatchObject({ homingCycles: 0, pos: { x: 40, y: 25 } });
    expect(outcome).toMatch(/reports no homing switches \(G28\.6\)/);
    const state = useLaserStore.getState();
    expect(state.homingState).not.toBe('confirmed');
    expect(state.safetyNotice).toMatchObject({ kind: 'home-unfinished' });
    expect(state.safetyNotice?.message).toMatch(/^Home was not confirmed\. /);
    expect(state.pendingUntrackedAcks).toBe(0);
  });

  it('does not confirm a Home whose `ok` came without a homing cycle', async () => {
    const sim = await connectSmoothie();
    // A `$H` answered at once, as by a build whose Home ran nothing.
    const connection = sim.port.connection as { write: (data: string) => Promise<void> };
    const write = connection.write;
    connection.write = async (data) => {
      if (data !== '$H\n') return write(data);
      setTimeout(() => sim.port.emitLine('ok'), 1);
    };

    const outcome = await homeOutcome();

    expect(sim.state().homingCycles).toBe(0);
    expect(outcome).toMatch(/reports X and Y not homed after Home \(G28\.6\)/);
    expect(useLaserStore.getState().homingState).not.toBe('confirmed');
  });
});
