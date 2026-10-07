import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { connectWith, makeConnection } from './laser-store-motion-operation.test-support';
import {
  finishMark,
  prepareMarkRequest,
  readyMarkPort,
  waitForMark,
} from './laser-job-start-mark.test-support';

beforeEach(() => {
  vi.useFakeTimers();
  ensureFramedRunInvalidationSubscriptions();
});
afterEach(async () => {
  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(2_000);
  await disconnect;
  vi.clearAllTimers();
  vi.useRealTimers();
  useExperimentalLaserFeatures.getState().resetFeatures();
  vi.restoreAllMocks();
});

function observe(promise: Promise<void>): Promise<void> {
  void promise.catch(() => undefined);
  return promise;
}

describe('start mark coordinate and cancellation ownership', () => {
  it('caps actual held Fire dispatch to the same observed S255 ceiling', async () => {
    const port = await readyMarkPort(255);
    await useLaserStore.getState().setFireActive(true, 5);
    expect(port.writes).toContain('G1 F1000 M3 S12\n');
    expect(useLaserStore.getState().fireActive).toBe(true);
    await useLaserStore.getState().setFireActive(false);
    expect(port.writes.at(-1)).toBe('M5\n');
  });
  it('uses final G54 work coordinates exactly once with a nonzero native work offset', async () => {
    const port = await readyMarkPort();
    port.wco = { x: 10, y: 20, z: 3 };
    port.emitStatus();
    const request = await prepareMarkRequest();
    expect(request.initialPosition).toEqual({ x: 31, y: 42, z: 0 });
    await finishMark(useLaserStore.getState().markJobStart(request));
    // Native absolute artwork starts at (1,399); the program has already
    // subtracted WCO (10,20). The mark must not subtract that offset again.
    expect(port.marks[0]?.point).toEqual({ x: -9, y: 379, z: 0 });
    expect({
      x: (port.marks[0]?.point.x ?? NaN) + port.wco.x,
      y: (port.marks[0]?.point.y ?? NaN) + port.wco.y,
    }).toEqual({ x: 1, y: 399 });
    expect(port.head).toEqual(request.initialPosition);
    expect(useLaserStore.getState().statusReport?.mPos).toEqual({ x: 41, y: 62, z: 3 });
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
  });

  it('keeps Current Position origin fixed before leaving a centre alignment head', async () => {
    const port = await readyMarkPort();
    useStore.setState({ jobPlacement: { startFrom: 'current-position', anchor: 'center' } });
    const request = await prepareMarkRequest();
    await finishMark(useLaserStore.getState().markJobStart(request));
    expect(port.marks[0]?.point).toEqual({ x: 27, y: 46, z: 0 });
    expect(port.marks[0]?.point).not.toEqual(request.initialPosition);
    expect(port.head).toEqual(request.initialPosition);
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
  });

  it('refuses an intervening WCO change instead of marking in the replacement origin', async () => {
    const port = await readyMarkPort();
    port.beforeWrite = (data) => {
      if (data.includes(' G1 X')) {
        port.beforeWrite = null;
        port.wco = { x: 1, y: 0, z: 0 };
        port.emitStatus();
      }
    };
    await expect(
      finishMark(useLaserStore.getState().markJobStart(await prepareMarkRequest())),
    ).rejects.toThrow('coordinate basis');
    expect(port.marks).toHaveLength(0);
    expect(port.writes).toContain('\x18');
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('rejects another Fire activation without hiding or altering the owned pulse latch', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const pending = observe(useLaserStore.getState().markJobStart(await prepareMarkRequest()));
    await waitForMark(port.pulsePending);
    const baseline = port.writes.length;
    await expect(useLaserStore.getState().setFireActive(true, 5)).rejects.toThrow(
      'controller operation',
    );
    expect(useLaserStore.getState().fireActive).toBe(true);
    expect(port.writes.length).toBe(baseline);
    port.finishPulse();
    await finishMark(pending);
  });

  it('does not send a late mark shutoff or return to a replacement controller session', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const pending = observe(useLaserStore.getState().markJobStart(await prepareMarkRequest()));
    await waitForMark(port.pulsePending);
    const replacementWrites: string[] = [];
    const replacement = makeConnection(async (data) => {
      replacementWrites.push(data);
    });
    const replacing = connectWith(replacement);
    await finishMark(replacing);
    await expect(pending).rejects.toThrow();
    replacementWrites.length = 0;
    port.connection.emitLine('ok');
    port.connection.emitLine('ok');
    await vi.advanceTimersByTimeAsync(3500);
    expect(
      replacementWrites.some(
        (line) => line === 'M5\n' || line === '\x18' || line.includes(' G1 X'),
      ),
    ).toBe(false);
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('allows Abort during long travel and stops owned polls without duplicate cancellation', async () => {
    const port = await readyMarkPort();
    port.simulateTravel = true;
    const pending = observe(useLaserStore.getState().markJobStart(await prepareMarkRequest()));
    await waitForMark(() => port.travelDurations.length === 1);
    await finishMark(useLaserStore.getState().stopJob());
    await expect(pending).rejects.toThrow();
    expect(port.writes.filter((line) => line === '\x18')).toHaveLength(1);
    expect(port.marks).toHaveLength(0);
    const baseline = port.writes.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(port.writes.slice(baseline).some((line) => line.includes(' G1 X'))).toBe(false);
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('settles mark cancellation after an early query reply without waiting for its held transport promise', async () => {
    const port = await readyMarkPort();
    port.synchronousStatus = true;
    let release!: () => void;
    let queried = false;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    port.afterQueryWrite = async () => {
      queried = true;
      await gate;
      port.afterQueryWrite = null;
    };
    const pending = observe(useLaserStore.getState().markJobStart(await prepareMarkRequest()));
    await waitForMark(() => queried);
    await finishMark(useLaserStore.getState().stopJob());
    await expect(finishMark(pending)).rejects.toThrow('cancelled');
    expect(port.marks).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    const baseline = port.writes.length;
    release();
    await vi.advanceTimersByTimeAsync(1000);
    expect(port.writes.slice(baseline).some((line) => line.includes(' G1 X'))).toBe(false);
  });

  it('never resurrects generic Frame evidence after an artwork edit and reversal during the mark', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const request = await prepareMarkRequest();
    const pending = observe(useLaserStore.getState().markJobStart(request));
    await waitForMark(port.pulsePending);
    const project = useStore.getState().project;
    useStore.setState({
      project: {
        ...project,
        scene: {
          ...project.scene,
          objects: project.scene.objects.map((object) => ({
            ...object,
            transform: { ...object.transform, x: object.transform.x + 1 },
          })),
        },
      },
    });
    expect(useLaserStore.getState().completedFrame).toBeNull();
    useStore.setState({ project });
    port.finishPulse();
    await finishMark(pending);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });
});
