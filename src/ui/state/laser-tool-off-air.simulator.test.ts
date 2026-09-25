// Controller audit CG-5: Smoothieware jog, Frame and Home start with the
// driver's tool-off lines, which end in M9, so the switch output bound to
// M8 goes off while the Manual Air rail still read ON (Smoothieware reports no
// accessory field to re-sync it from, Kernel.cpp L177-L300). The latch now
// clears once the transport accepts that M9.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSmoothieSimulator, type SmoothieSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from './laser-store';
import { toolOffAirPatch } from './laser-tool-off-air';
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
    airAssistOn: false,
  });
  resetStore();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function pump(ms = 10): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

async function connectWithAirOn(): Promise<SmoothieSimulator> {
  const sim = createSmoothieSimulator();
  useStore
    .getState()
    .updateDeviceProfile({ controllerKind: 'smoothieware', airAssistCommand: 'M8' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'smoothieware' });
  await pump(1_200);
  await useLaserStore.getState().setAirAssistEnabled(true);
  await pump(50);
  expect(useLaserStore.getState().airAssistOn).toBe(true);
  expect(sim.state().coolant.flood).toBe(true);
  return sim;
}

describe('CG-5: the Manual Air latch follows the tool-off M9', () => {
  it.each([
    ['jog', () => useLaserStore.getState().jog({ dx: 5, feed: 1_000 })],
    [
      'Frame',
      () => useLaserStore.getState().frame({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 1_000),
    ],
    ['Home', () => useLaserStore.getState().home()],
  ])('clears it when a %s sends M9', async (_label, move) => {
    const sim = await connectWithAirOn();
    const moving = move().catch(() => undefined);
    await pump(10_000);
    await moving;
    expect(sim.state().coolant.flood).toBe(false);
    expect(useLaserStore.getState().airAssistOn).toBe(false);
  });

  it('reacts only to an accepted M9 in a motion prefix', () => {
    expect(toolOffAirPatch('fire off\nM400\nM221 S0\nM5\nM9\nM120\n', 'jog')).toEqual({
      airAssistOn: false,
    });
    expect(toolOffAirPatch('M9\n', 'frame')).toEqual({ airAssistOn: false });
    expect(toolOffAirPatch('M9\n', 'air-assist')).toEqual({});
    expect(toolOffAirPatch('G0 X10 F1000\n', 'jog')).toEqual({});
    expect(toolOffAirPatch('M90\n', 'home')).toEqual({});
  });
});
