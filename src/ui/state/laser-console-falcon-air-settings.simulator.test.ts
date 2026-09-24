// The Falcon A1 Pro Console against the scripted GRBL simulator (ADR-370). The
// vendor contract keeps numeric `$N=` writes out of host software except the
// air-assist settings Creality documents for console use, $150-$152, so the
// `$152=100` that Job Review recommends can be sent from KerfDesk itself.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
// Deep import: the devices barrel is at its public-export ratchet.
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../core/devices/falcon-profiles';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  resetStore();
  vi.restoreAllMocks();
});

async function pump(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

/** A Console write waits for a fresh Idle report, which the simulator only
 *  sends as time passes. */
async function settle(pending: Promise<void>): Promise<void> {
  let settled = false;
  const tracked = pending.finally(() => {
    settled = true;
  });
  for (let tick = 0; tick < 500 && !settled; tick += 1) await pump(1);
  await tracked;
}

async function connectFalcon(): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ firmwareBanner: 'GrblHAL 1.1f' });
  useStore.getState().updateDeviceProfile(FALCON_A1_PRO_GRBLHAL_PROFILE);
  await useLaserStore.getState().connect(sim.adapter, {
    controllerKind: 'grblhal',
    controllerCommandSet: 'creality-falcon-a1-pro',
  });
  await pump(1100); // banner, then the first Idle status poll
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('Falcon A1 Pro Console air settings', () => {
  it('sends $152=100 and still refuses every other numeric setting write', async () => {
    const sim = await connectFalcon();
    const send = useLaserStore.getState().sendConsoleCommand;

    await settle(send('$152=100', { confirmed: true }));
    expect(sim.outbound()).toContain('$152=100\n');

    await expect(send('$110=36000', { confirmed: true })).rejects.toThrow(
      /does not send numeric \$ setting writes other than \$150, \$151 and \$152/,
    );
    await expect(send('$152=150', { confirmed: true })).rejects.toThrow(
      /whole number from 0 to 100/,
    );
    expect(sim.outbound()).not.toContain('$110=36000\n');
    expect(sim.outbound()).not.toContain('$152=150\n');
  });
});
