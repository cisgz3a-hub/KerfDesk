import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { LASER_START_OVERRIDE_RESET } from './laser-start-override-reset';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
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
  // Disconnect joins any reset started at the last body tick. Keep that clock
  // alive through its bounded boot and cleanup windows before discarding it.
  const disconnect = useLaserStore.getState().disconnect();
  await vi.advanceTimersByTimeAsync(2_000);
  await disconnect;
  vi.clearAllTimers();
  vi.useRealTimers();
  useExperimentalLaserFeatures.getState().resetFeatures();
  vi.restoreAllMocks();
});

function runMark(
  request: Parameters<ReturnType<typeof useLaserStore.getState>['markJobStart']>[0],
): Promise<void> {
  const promise = useLaserStore.getState().markJobStart(request);
  void promise.catch(() => undefined);
  return promise;
}

describe('actual-store job-start mark lifecycle', () => {
  it('marks the first powered wire point for one second and retains the exact completed Frame only after returning', async () => {
    const port = await readyMarkPort();
    const request = await prepareMarkRequest();
    const proof = request.frame?.candidate.frameVerification;
    await finishMark(runMark(request));
    expect(port.marks).toEqual([
      {
        point: { x: 1, y: 399, z: 0 },
        power: 10,
        startedAt: expect.any(Number),
        endedAt: expect.any(Number),
      },
    ]);
    expect((port.marks[0]?.endedAt ?? 0) - (port.marks[0]?.startedAt ?? 0)).toBe(1000);
    expect(port.head).toEqual(request.initialPosition);
    expect(port.writes.filter((line) => line.includes(' G1 X'))).toHaveLength(2);
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
    expect(useLaserStore.getState().framedRun).toBe(request.frame);
    expect(useLaserStore.getState().frameVerification).toBe(proof);
    expect(useLaserStore.getState().fireActive).toBe(false);
    expect(useLaserStore.getState().controllerOperation).toBeNull();
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(0);
  });

  it('does not mint Frame evidence or a Start permit for an unframed mark', async () => {
    const port = await readyMarkPort();
    await finishMark(runMark(await prepareMarkRequest(false)));
    expect(port.marks).toHaveLength(1);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(useLaserStore.getState().framedRun).toBeNull();
  });

  it('waits for all three pulse ACKs even when a fresh Idle follows the first ACK', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const pending = runMark(await prepareMarkRequest());
    await waitForMark(port.pulsePending);
    port.emitStatus();
    await vi.advanceTimersByTimeAsync(1000);
    expect(useLaserStore.getState().pendingUntrackedAcks).toBe(2);
    expect(port.writes.filter((line) => line.includes(' G1 X'))).toHaveLength(1);
    expect(useLaserStore.getState().fireActive).toBe(true);
    port.finishPulse();
    await finishMark(pending);
    expect(port.writes.filter((line) => line.includes(' G1 X'))).toHaveLength(2);
  });

  it('settles physically timed long travel and return with a full override baseline', async () => {
    const port = await readyMarkPort();
    port.simulateTravel = true;
    port.feedOverridePercent = 10;
    useLaserStore.setState({ ovCache: { feed: 10, rapid: 25, spindle: 200 } });
    const request = await prepareMarkRequest();
    const pending = runMark(request);
    await finishMark(pending);
    const expectedMs = (Math.hypot(30, 357) * 60_000) / 1000;
    expect(port.travelDurations).toEqual([expectedMs, expectedMs]);
    expect(port.travelDurations.every((ms) => ms > 6000)).toBe(true);
    const baseline = port.writes.indexOf(LASER_START_OVERRIDE_RESET);
    const firstMove = port.writes.findIndex((line) => line.includes(' G1 X'));
    expect(baseline).toBeGreaterThan(0);
    expect(baseline).toBeLessThan(firstMove);
    expect(port.writes.slice(firstMove).filter((line) => line === '?').length).toBeGreaterThan(100);
    expect(port.writes).not.toContain('\x18');
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
    expect((port.marks[0]?.endedAt ?? 0) - (port.marks[0]?.startedAt ?? 0)).toBe(1000);
  });

  it('retains a synchronous query reply while its transport promise remains unresolved', async () => {
    const port = await readyMarkPort();
    port.synchronousStatus = true;
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let queried = false;
    port.afterQueryWrite = async () => {
      queried = true;
      await gate;
      port.afterQueryWrite = null;
    };
    const pending = runMark(await prepareMarkRequest());
    await waitForMark(() => queried);
    expect(port.writes.filter((line) => line.includes(' G1 X'))).toHaveLength(0);
    release();
    await finishMark(pending);
    expect(port.marks).toHaveLength(1);
    expect(port.writes).not.toContain('\x18');
  });

  it('keeps a long planner drain alive while its transport promise is unresolved and still requires the owned ACK', async () => {
    const port = await readyMarkPort();
    port.simulateTravel = true;
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    let drainWritten = false;
    port.beforeWrite = async (data) => {
      const operation = useLaserStore.getState().controllerOperation;
      if (
        operation?.kind === 'job-start-mark' &&
        operation.phase === 'travel' &&
        data.startsWith('G4')
      ) {
        drainWritten = true;
        await gate;
        port.beforeWrite = null;
      }
    };
    const pending = runMark(await prepareMarkRequest());
    await waitForMark(() => drainWritten);
    await vi.advanceTimersByTimeAsync(6000);
    expect(port.writes).not.toContain('\x18');
    expect(port.marks).toHaveLength(0);
    release();
    await finishMark(pending);
    expect(port.marks).toHaveLength(1);
  });

  it('fails a never-settling query handoff even when a genuine synchronous Idle reply already arrived', async () => {
    const port = await readyMarkPort();
    port.synchronousStatus = true;
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    port.afterQueryWrite = async () => {
      await gate;
      port.afterQueryWrite = null;
    };
    const pending = runMark(await prepareMarkRequest());
    await expect(finishMark(pending)).rejects.toThrow('handoff timed out');
    expect(port.marks).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    release();
  });

  it('uses the smaller observed same-session S ceiling instead of the saved profile range', async () => {
    const port = await readyMarkPort(255);
    await finishMark(runMark(await prepareMarkRequest()));
    expect(port.marks[0]?.power).toBe(2);
    expect(port.writes).toContain('G1 F1000 M3 S2\nG4 P1\nM5\n');
    expect(useStore.getState().project.device.maxPowerS).toBe(1000);
  });

  it('rechecks a smaller freshly observed ceiling before the pulse, after travel', async () => {
    const port = await readyMarkPort();
    port.beforeWrite = (data) => {
      const operation = useLaserStore.getState().controllerOperation;
      if (
        operation?.kind === 'job-start-mark' &&
        operation.phase === 'travel' &&
        data.startsWith('G4')
      ) {
        useLaserStore.setState({
          controllerSettings: { ...useLaserStore.getState().controllerSettings, maxPowerS: 255 },
        });
      }
    };
    await finishMark(runMark(await prepareMarkRequest()));
    expect(port.marks[0]?.power).toBe(2);
  });

  it('refuses a rejected travel before firing and revokes Frame through bound Abort', async () => {
    const port = await readyMarkPort();
    port.refusal = / G1 X/;
    await expect(finishMark(runMark(await prepareMarkRequest()))).rejects.toThrow('error:20');
    expect(port.marks).toHaveLength(0);
    expect(port.writes).toContain('\x18');
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('contains a partially accepted pulse write with Abort and never retains Frame', async () => {
    const port = await readyMarkPort();
    port.failPulseWrite = true;
    await expect(finishMark(runMark(await prepareMarkRequest()))).rejects.toThrow(
      'Partially delivered',
    );
    expect(port.marks).toHaveLength(1);
    expect(port.writes).toContain('\x18');
    expect(useLaserStore.getState().fireActive).toBe(false);
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('rejects unexpected return Z drift, including one directly reported tick', async () => {
    const port = await readyMarkPort();
    port.driftReturnZ = 0.001;
    await expect(finishMark(runMark(await prepareMarkRequest()))).rejects.toThrow(
      'original observed XYZ',
    );
    expect(useLaserStore.getState().completedFrame).toBeNull();
    expect(port.writes).toContain('\x18');
  });

  it('does not pulse when the travel ACK fence is followed by fresh Run instead of Idle', async () => {
    const port = await readyMarkPort();
    port.beforeWrite = (data) => {
      const operation = useLaserStore.getState().controllerOperation;
      if (
        operation?.kind === 'job-start-mark' &&
        operation.phase === 'travel' &&
        data.startsWith('G4')
      )
        port.queryState = 'Run';
    };
    await expect(finishMark(runMark(await prepareMarkRequest()))).rejects.toThrow('fresh Idle');
    expect(port.marks).toHaveLength(0);
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('expires on motion-report silence without converting the last Run into arrival evidence', async () => {
    const port = await readyMarkPort();
    port.simulateTravel = true;
    port.beforeWrite = (data) => {
      const operation = useLaserStore.getState().controllerOperation;
      if (
        operation?.kind === 'job-start-mark' &&
        operation.phase === 'travel' &&
        data.startsWith('G4')
      )
        port.queryState = null;
    };
    await expect(finishMark(runMark(await prepareMarkRequest()))).rejects.toThrow('timed out');
    expect(port.marks).toHaveLength(0);
    expect(port.writes).toContain('\x18');
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });

  it('routes deliberate Laser off during an owned mark through Abort without an extra pulse ACK', async () => {
    const port = await readyMarkPort();
    port.holdPulseAcks = true;
    const pending = runMark(await prepareMarkRequest());
    await waitForMark(port.pulsePending);
    const before = port.writes.length;
    const stopping = useLaserStore.getState().setFireActive(false);
    await finishMark(stopping);
    await expect(pending).rejects.toThrow();
    expect(port.writes.slice(before)[0]).toBe('\x18');
    expect(useLaserStore.getState().completedFrame).toBeNull();
  });
});
