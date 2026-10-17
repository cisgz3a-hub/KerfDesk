import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createGrblSimulator,
  createMarlinSimulator,
  createSmoothieSimulator,
} from '../../__fixtures__/controllers';
import type { ControllerKind } from '../../core/devices/device-profile';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { resetStore } from './test-helpers';
import { disconnectOnTestClock } from './laser-disconnect-testing';

beforeEach(() => {
  vi.useFakeTimers();
  resetStore();
});
afterEach(async () => {
  await disconnectOnTestClock();
  resetStore();
  vi.useRealTimers();
});

async function finish(operation: Promise<void>): Promise<void> {
  let done = false;
  const result = operation.finally(() => {
    done = true;
  });
  void result.catch(() => undefined);
  for (let tick = 0; tick < 200 && !done; tick++) await vi.advanceTimersByTimeAsync(50);
  await result;
}

const families: ControllerKind[] = ['grbl-v1.1', 'grblhal', 'fluidnc', 'marlin', 'smoothieware'];
describe('positioning light through real store serial and ACK ownership', () => {
  it('releases a failed Marlin positioning operation after its no-reset quickstop', async () => {
    const sim = createMarlinSimulator({
      rejectLines: [{ pattern: /^G0 /, error: 'Positioning move refused' }],
    });
    useStore.getState().updateDeviceProfile({
      controllerKind: 'marlin',
      positioningLight: { onCommand: 'M7', offCommand: 'M9', offsetXmm: 0, offsetYmm: 0 },
    });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: 'marlin' });
    await vi.advanceTimersByTimeAsync(1500);
    const operation = useLaserStore.getState().centrePositioningLight(10, 15, 1000);
    const rejected = expect(operation).rejects.toThrow('Positioning move refused');
    await finish(operation.catch(() => undefined));
    await rejected;
    expect(sim.outbound().join('')).toContain('M410\n');
    expect(sim.outbound().join('')).not.toContain('M7\n');
    expect(useLaserStore.getState().controllerOperation).toBeNull();
  });

  it.each(families)('finishes a mapped auxiliary light exchange on %s', async (kind) => {
    const sim =
      kind === 'marlin'
        ? createMarlinSimulator()
        : kind === 'smoothieware'
          ? createSmoothieSimulator()
          : createGrblSimulator();
    // The scripted fixtures expose coolant as their auxiliary output. This is
    // an explicit test mapping, never a machine default or crosshair detection.
    useStore.getState().updateDeviceProfile({
      controllerKind: kind,
      positioningLight: { onCommand: 'M7', offCommand: 'M9', offsetXmm: 0, offsetYmm: 0 },
    });
    await useLaserStore.getState().connect(sim.adapter, { controllerKind: kind });
    await vi.advanceTimersByTimeAsync(1500);
    expect(useLaserStore.getState().statusReport?.state).toBe('Idle');
    await finish(useLaserStore.getState().centrePositioningLight(10, 15, 1000));
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
    expect(sim.outbound().join('')).toContain('M7\n');
    await finish(useLaserStore.getState().switchPositioningLightOff());
    expect(useLaserStore.getState().positioningLightEnabled).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it.each(families)('switches a lit light off as part of Disconnect on %s', async (kind) => {
    const offLinesAtDisconnect = async (lightOn: boolean): Promise<number> => {
      resetStore();
      const sim =
        kind === 'marlin'
          ? createMarlinSimulator()
          : kind === 'smoothieware'
            ? createSmoothieSimulator()
            : createGrblSimulator();
      useStore.getState().updateDeviceProfile({
        controllerKind: kind,
        positioningLight: { onCommand: 'M7', offCommand: 'M9', offsetXmm: 0, offsetYmm: 0 },
      });
      await useLaserStore.getState().connect(sim.adapter, { controllerKind: kind });
      await vi.advanceTimersByTimeAsync(1500);
      if (lightOn) await finish(useLaserStore.getState().centrePositioningLight(10, 15, 1000));
      const before = sim.outbound().length;
      await disconnectOnTestClock();
      await vi.advanceTimersByTimeAsync(5000);
      return sim
        .outbound()
        .slice(before)
        .join('')
        .split('\n')
        .filter((line) => line.trim() === 'M9').length;
    };
    const unlit = await offLinesAtDisconnect(false);
    expect(await offLinesAtDisconnect(true)).toBe(unlit + 1);
  });
});
