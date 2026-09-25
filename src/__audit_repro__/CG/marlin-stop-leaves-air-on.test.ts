// Audit CG-10 repro: on Marlin, Abort and Disconnect never switch air assist off,
// and Abort clears the Manual Air latch, so the rail shows air OFF while the
// pump still runs.
//
// Manual Air sends the profile's M7/M8 and M9 on every driver (laser-store.ts
// airAssistActions). The Marlin stop set is MARLIN_STOP_LASER_LINES =
// ['M5 I', 'M107'] (marlin/commands.ts), used for Abort (laser-job-actions.ts
// runStopJob, softReset === null branch) and for Disconnect
// (laser-store-helpers.ts disconnectStopCommands: `if (state.airAssistOn) return
// driver.commands.stopLaserLines`). Neither line touches air assist. Abort then
// sets airAssistOn: false unconditionally.
//
// Upstream Marlin 2.1.2.8: only M9 calls cutter.air_assist_disable()
// (gcode/control/M7-M9.cpp L64-L75, AIR_ASSIST); M5 and M107 do not, and
// Marlin has no realtime reset that would drop outputs. On the GRBL family the
// soft reset itself stops coolant (and stopLaserLines is ['M9']); on
// Smoothieware the halt drives switches to their failsafe and the reset cleanup
// sends M5, M9.
// https://github.com/MarlinFirmware/Marlin/blob/2.1.2.8/Marlin/src/gcode/control/M7-M9.cpp#L64-L75
//
// Correct behaviour: Abort and Disconnect send M9 on a controller whose air was
// switched on by KerfDesk (or the air latch is left ON when it was not switched
// off).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarlinSimulator, type MarlinSimulator } from '../../__fixtures__/controllers';
import { grblDriver } from '../../core/controllers';
import { useLaserStore } from '../../ui/state/laser-store';
import { useStore } from '../../ui/state/store';
import { resetStore } from '../../ui/state/test-helpers';

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
    airAssistOn: false,
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

async function connectMarlinWithAirOn(): Promise<MarlinSimulator> {
  const sim = createMarlinSimulator();
  useStore.getState().updateDeviceProfile({ controllerKind: 'marlin', airAssistCommand: 'M8' });
  await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
  await pump(1_200);
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  await settle(useLaserStore.getState().setAirAssistEnabled(true));
  await pump(500);
  expect(sim.outbound()).toContain('M8\n');
  expect(useLaserStore.getState().airAssistOn).toBe(true);
  return sim;
}

function airOffAfterAirOn(outbound: ReadonlyArray<string>): boolean {
  return outbound.lastIndexOf('M9\n') > outbound.lastIndexOf('M8\n');
}

describe('CG-10: Marlin stop paths and air assist', () => {
  it('Abort switches air assist off, or keeps showing it on', async () => {
    const sim = await connectMarlinWithAirOn();
    await settle(useLaserStore.getState().stopJob());
    await pump(1_000);
    const airOffSent = airOffAfterAirOn(sim.outbound());
    const airAssistOn = useLaserStore.getState().airAssistOn;
    // Fails today: M5 I and M107 are sent, no M9, and airAssistOn is false.
    expect(
      airOffSent || airAssistOn,
      JSON.stringify({ outbound: sim.outbound().slice(-4), airAssistOn }),
    ).toBe(true);
  });

  it('Disconnect switches air assist off', async () => {
    const sim = await connectMarlinWithAirOn();
    await settle(useLaserStore.getState().disconnect());
    // Fails today: only M5 I and M107 go out before the port closes.
    expect(airOffAfterAirOn(sim.outbound()), JSON.stringify(sim.outbound().slice(-4))).toBe(true);
  });
});
