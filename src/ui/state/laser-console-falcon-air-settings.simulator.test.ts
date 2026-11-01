// The Falcon Console against the scripted GRBL simulator (ADR-370 and its
// Amendment 1). The vendor contract keeps numeric `$N=` writes out of host
// software. On stock GRBL it still lists the Falcon A1 air settings Creality
// documents for console use, $150-$152, so the `$152=100` that Job Review
// recommends there can be sent from KerfDesk itself. On grblHAL, the Falcon A1
// Pro preset's firmware, $150-$152 are the X, Y and Z microsteps (rolling audit
// v5 J8-P3-2), so none of them reaches the wire.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGrblSimulator, type GrblSimulator } from '../../__fixtures__/controllers';
import type { ControllerKind } from '../../core/devices';
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

async function connectFalcon(
  controllerKind: ControllerKind,
  firmwareBanner: string,
): Promise<GrblSimulator> {
  const sim = createGrblSimulator({ firmwareBanner });
  useStore.getState().updateDeviceProfile({ ...FALCON_A1_PRO_GRBLHAL_PROFILE, controllerKind });
  await useLaserStore.getState().connect(sim.adapter, {
    controllerKind,
    controllerCommandSet: 'creality-falcon-a1-pro',
  });
  await pump(1100); // banner, then the first Idle status poll
  expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
  return sim;
}

describe('Falcon Console air settings', () => {
  it('sends $152=100 on a stock-GRBL Falcon and still refuses every other numeric setting write', async () => {
    const sim = await connectFalcon('grbl-v1.1', "Grbl 1.1f ['$' for help]");
    const send = useLaserStore.getState().sendConsoleCommand;

    const readsAtConnect = sim.outbound().filter((line) => line === '$$\n').length;
    await settle(send('$152=100', { confirmed: true }));
    expect(sim.outbound()).toContain('$152=100\n');
    // The contract reads `$$` (ADR-322 Amendment 3): once at connect, and again
    // after the write to see what the controller stored.
    expect(readsAtConnect).toBe(1);
    await pump(500);
    expect(sim.outbound().filter((line) => line === '$$\n')).toHaveLength(2);
    expect(useLaserStore.getState().controllerQualification).toMatchObject({
      kind: 'qualified',
      settings: 'verified',
    });

    await expect(send('$110=36000', { confirmed: true })).rejects.toThrow(
      /does not send numeric \$ setting writes other than \$150, \$151 and \$152/,
    );
    await expect(send('$152=150', { confirmed: true })).rejects.toThrow(
      /whole number from 0 to 100/,
    );
    expect(sim.outbound()).not.toContain('$110=36000\n');
    expect(sim.outbound()).not.toContain('$152=150\n');
  });

  it('sends no $150-$152 write on the Falcon A1 Pro preset (grblHAL)', async () => {
    const sim = await connectFalcon('grblhal', 'GrblHAL 1.1f');
    const send = useLaserStore.getState().sendConsoleCommand;

    for (const command of ['$152=100', '$150=32', '$151=8', '$152=8']) {
      await expect(send(command, { confirmed: true }), command).rejects.toThrow(
        /microstep setting, not a Falcon A1 air setting/,
      );
      expect(sim.outbound()).not.toContain(`${command}\n`);
    }
  });

  it('refuses the A1 air settings when a stock-GRBL Falcon profile meets a grblHAL banner', async () => {
    const sim = await connectFalcon('grbl-v1.1', 'GrblHAL 1.1f');
    const send = useLaserStore.getState().sendConsoleCommand;

    await expect(send('$152=100', { confirmed: true })).rejects.toThrow(
      /listed for stock-GRBL firmware, but this controller greets as grblHAL/,
    );
    expect(sim.outbound()).not.toContain('$152=100\n');
  });
});
