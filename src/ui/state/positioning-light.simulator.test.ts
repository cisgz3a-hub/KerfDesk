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
import { prepareOutputRequestForTest } from '../../__fixtures__/output-preparation-request';
import { connectedFixture } from '../laser/frame-artwork-centre-led.test-support';
import { runFrameNow } from '../laser/use-frame-action';
import { framedRunStartHandoffIssue } from './framed-run';
import { inferCurrentMachinePosition } from './infer-machine-position';
import type * as OutputPreparationWorker from '../laser/output-preparation-worker-client';

vi.mock('./job-aware-dialogs', () => ({
  jobAwareAlert: vi.fn(),
  jobAwareConfirm: vi.fn(() => true),
}));
vi.mock('../laser/output-preparation-worker-client', async (importOriginal) => ({
  ...(await importOriginal<typeof OutputPreparationWorker>()),
  prepareStartOutputOffThread: async (
    request: Parameters<typeof prepareOutputRequestForTest>[0],
  ) => {
    const response = await prepareOutputRequestForTest(request);
    if (response.kind !== 'start') throw new Error('Expected start preparation');
    return response.result;
  },
}));

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
    const lastOn = sim.outbound().length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
    expect(sim.outbound().slice(lastOn).join('')).not.toContain('M9\n');
    await finish(useLaserStore.getState().switchPositioningLightOff());
    expect(useLaserStore.getState().positioningLightEnabled).toBe(false);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it.each(families)('switches a lit light off as part of Disconnect on %s', async (kind) => {
    const offLinesAtDisconnect = async (mode: 'off' | 'centre' | 'on'): Promise<number> => {
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
      if (mode === 'centre')
        await finish(useLaserStore.getState().centrePositioningLight(10, 15, 1000));
      else if (mode === 'on') await finish(useLaserStore.getState().switchPositioningLightOn());
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
    const unlit = await offLinesAtDisconnect('off');
    expect(await offLinesAtDisconnect('centre')).toBe(unlit + 1);
    expect(await offLinesAtDisconnect('on')).toBe(unlit + 1);
  });
});

describe('independent LED switching with a real completed Frame', () => {
  it.each(families)(
    'preserves captured Current Position placement without motion on %s',
    async (kind) => {
      const { sim } = await connectedFixture(kind, 'current-position');
      const framed = runFrameNow();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await framed).toBe(true);
      const permit = useLaserStore.getState().completedFrame!;
      expect(permit).not.toBeNull();
      const position = inferCurrentMachinePosition(
        useLaserStore.getState().statusReport,
        useLaserStore.getState().wcoCache,
      );
      const origin = permit.candidate.preparedStart.jobOrigin;
      const firstWrite = sim.outbound().length;
      await finish(useLaserStore.getState().switchPositioningLightOn());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(useLaserStore.getState().positioningLightEnabled).toBe(true);
      expect(sim.outbound().slice(firstWrite).join('')).toContain('M7\n');
      const afterOn = sim.outbound().slice(firstWrite).join('').split('M7\n')[1]!;
      expect(afterOn).not.toContain('M9\n');
      expect(useLaserStore.getState().completedFrame).toBe(permit);
      expect(useLaserStore.getState().framedRun).toBe(permit);
      await finish(useLaserStore.getState().switchPositioningLightOff());
      const laser = useLaserStore.getState();
      expect(laser.positioningLightEnabled).toBe(false);
      expect(laser.completedFrame).toBe(permit);
      expect(laser.completedFrame?.candidate.preparedStart.jobOrigin).toBe(origin);
      expect(inferCurrentMachinePosition(laser.statusReport, laser.wcoCache)).toEqual(position);
      expect(framedRunStartHandoffIssue(permit, laser)).toBeNull();
      expect(laser.pendingUntrackedAcks).toBe(0);
      expect(laser.controllerOperation).toBeNull();
      const sent = sim
        .outbound()
        .slice(firstWrite)
        .map((line) => line.trim());
      expect(
        sent.some((line) => /^(?:\$J=|\$H|G(?:0|1|10|28|54|90|91|92)(?:\s|$))/.test(line)),
      ).toBe(false);
    },
  );
});
