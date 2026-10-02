import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureFramedRunInvalidationSubscriptions } from '../laser/framed-run-invalidation';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { runJobStartMarkNow, useJobStartMarkPreparation } from '../laser/use-job-start-mark';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import {
  finishMark,
  prepareMarkRequest,
  readyMarkPort,
  waitForMark,
} from './laser-job-start-mark.test-support';
import { MarkWire, type MarkPort } from './laser-job-start-mark-wire.test-support';
import { connectWith } from './laser-store-motion-operation.test-support';
import { useLaserStore } from './laser-store';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { useStore } from './store';

beforeEach(() => {
  vi.useFakeTimers();
  ensureFramedRunInvalidationSubscriptions();
  useJobStartMarkPreparation.setState({ pending: false });
});

afterEach(async () => {
  vi.clearAllTimers();
  vi.useRealTimers();
  await useLaserStore.getState().disconnect();
  useExperimentalLaserFeatures.getState().resetFeatures();
  vi.restoreAllMocks();
});

function defer() {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function readActualFakeSettings(port: MarkPort, maxPowerS = 1000): Promise<void> {
  port.beforeWrite = (data) => {
    if (data === '$$\n') {
      for (const setting of ['$13=0', `$30=${maxPowerS}`, '$31=0', '$32=1'])
        port.connection.emitLine(setting);
    }
    if (data === '$I\n') {
      port.connection.emitLine('[VER:1.1h.20190830:post-release-audit]');
      port.connection.emitLine('[OPT:VM,15,128]');
    }
  };
  try {
    await finishMark(useLaserStore.getState().readMachineSettings());
  } finally {
    port.beforeWrite = null;
  }
  expect(useLaserStore.getState().controllerSettings?.maxPowerS).toBe(maxPowerS);
  expect(useLaserStore.getState().controllerSettingsObservation?.sessionEpoch).toBe(
    useLaserStore.getState().controllerSessionEpoch,
  );
}

function hold(promise: Promise<void>): Promise<void> {
  void promise.catch(() => undefined);
  return promise;
}

async function finishUi(promise: Promise<boolean>): Promise<boolean> {
  await finishMark(promise.then(() => undefined));
  return promise;
}

describe('post-release delayed mark ownership across a new operation', () => {
  it('cannot let an old replied-but-unsettled query take over a new pulse on a replacement controller', async () => {
    const old = await readyMarkPort();
    old.synchronousStatus = true;
    const gate = defer();
    let held = false;
    old.afterQueryWrite = async () => {
      old.afterQueryWrite = null;
      held = true;
      await gate.promise;
    };
    const original = await prepareMarkRequest();
    const cancelled = hold(useLaserStore.getState().markJobStart(original));
    await waitForMark(() => held);
    await finishMark(useLaserStore.getState().stopJob());
    await expect(finishMark(cancelled)).rejects.toThrow();
    expect(useLaserStore.getState().completedFrame).toBeNull();
    const replacement = new MarkWire();
    await finishMark(connectWith(replacement.port.connection));
    await settleTestGrblHandshake();
    replacement.ready = true;
    replacement.port.head = { x: 62, y: 73, z: 4 };
    replacement.port.wco = { x: 5, y: 7, z: 2 };
    replacement.port.holdPulseAcks = true;
    await readActualFakeSettings(replacement.port, 255);
    replacement.port.emitStatus();
    const request = await prepareMarkRequest();
    expect(request.controller.controllerSessionEpoch).not.toBe(
      original.controller.controllerSessionEpoch,
    );
    const retry = hold(useLaserStore.getState().markJobStart(request));
    let retryError: unknown = null;
    void retry.catch((error: unknown) => {
      retryError = error;
    });
    await vi.advanceTimersByTimeAsync(300);
    expect(replacement.port.pulsePending(), String(retryError)).toBe(true);
    const owner = useLaserStore.getState().controllerOperation;
    const baseline = [...replacement.port.writes];
    expect(useLaserStore.getState().fireActive).toBe(true);
    gate.resolve();
    old.connection.emitLine('ok');
    old.connection.emitLine('<Run|MPos:999,888,777|WCO:99,88,77|FS:1000,1000>');
    await vi.advanceTimersByTimeAsync(150);
    expect(replacement.port.writes).toEqual(baseline);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().fireActive).toBe(true);
    expect(useLaserStore.getState().statusReport?.wco).toEqual({ x: 5, y: 7, z: 2 });
    replacement.port.finishPulse();
    await finishMark(retry);
    expect(replacement.port.marks).toHaveLength(1);
    expect(replacement.port.marks[0]?.power).toBe(2);
    expect(replacement.port.marks[0]?.point).toEqual({ x: -4, y: 392, z: 4 });
    expect(replacement.port.head).toEqual(request.initialPosition);
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
    expect(useLaserStore.getState().fireActive).toBe(false);
    expect(old.marks).toHaveLength(0);
  });

  it('releases the UI single-flight latch after Abort and cannot clear a retry latch when the old transport finally resolves', async () => {
    const port = await readyMarkPort();
    await installReviewPendingFramedRunPermitForCurrentState();
    port.synchronousStatus = true;
    const gate = defer();
    let held = false;
    port.afterQueryWrite = async () => {
      if (useLaserStore.getState().controllerOperation?.kind !== 'job-start-mark') return;
      port.afterQueryWrite = null;
      held = true;
      await gate.promise;
    };
    const first = runJobStartMarkNow();
    await waitForMark(() => held, 1_000);
    expect(useJobStartMarkPreparation.getState().pending).toBe(true);
    expect(await runJobStartMarkNow()).toBe(false);
    await finishMark(useLaserStore.getState().stopJob());
    expect(await finishUi(first)).toBe(false);
    expect(useJobStartMarkPreparation.getState().pending).toBe(false);
    expect(useLaserStore.getState().completedFrame).toBeNull();
    await vi.advanceTimersByTimeAsync(1_200);
    await settleTestGrblHandshake();
    port.emitStatus();
    await readActualFakeSettings(port);
    const frame = await installReviewPendingFramedRunPermitForCurrentState();
    port.holdPulseAcks = true;
    const retry = runJobStartMarkNow();
    await waitForMark(port.pulsePending, 1_000);
    const owner = useLaserStore.getState().controllerOperation;
    gate.resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(useJobStartMarkPreparation.getState().pending).toBe(true);
    expect(useLaserStore.getState().controllerOperation).toBe(owner);
    expect(useLaserStore.getState().fireActive).toBe(true);
    port.finishPulse();
    expect(await finishUi(retry)).toBe(true);
    expect(useJobStartMarkPreparation.getState().pending).toBe(false);
    expect(useLaserStore.getState().completedFrame).toBe(frame);
    expect(port.marks).toHaveLength(1);
    expect(port.writes.filter((data) => data === '\x18')).toHaveLength(1);
  });

  it('does not increase admitted mark power after a range increase and locks realtime override edits only until return', async () => {
    const port = await readyMarkPort(255);
    port.simulateTravel = true;
    port.feedOverridePercent = 200;
    const request = await prepareMarkRequest();
    const pending = hold(useLaserStore.getState().markJobStart(request));
    await waitForMark(() => port.travelDurations.length === 1);
    expect(port.feedOverridePercent).toBe(100);
    const project = useStore.getState().project;
    const before = port.writes.length;
    await expect(useLaserStore.getState().sendRealtimeOverride('\x93')).rejects.toThrow(
      'timed start mark',
    );
    expect(port.writes.length).toBe(before);
    const epoch = useLaserStore.getState().controllerSessionEpoch;
    useLaserStore.setState({
      controllerSettings: { maxPowerS: 1000, minPowerS: 0, laserModeEnabled: true },
      controllerSettingsObservation: { sessionEpoch: epoch, observedAt: Date.now() },
    });
    await finishMark(pending);
    expect(port.marks[0]?.power).toBe(2);
    expect((port.marks[0]?.endedAt ?? NaN) - (port.marks[0]?.startedAt ?? NaN)).toBe(1000);
    expect(useLaserStore.getState().completedFrame).toBe(request.frame);
    expect(useStore.getState().project).toBe(project);
    await useLaserStore.getState().sendRealtimeOverride('\x93');
    expect(port.writes.at(-1)).toBe('\x93');
  });
});
