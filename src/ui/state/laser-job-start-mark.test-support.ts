import { expect, vi } from 'vitest';
import { installFrameOnceProject } from '../laser/frame-once.test-support';
import { installReviewPendingFramedRunPermitForCurrentState } from '../laser/framed-run-testing';
import { prepareCurrentStartJob } from '../laser/start-job-source';
import { useCameraStore } from './camera-store';
import { useExperimentalLaserFeatures } from './experimental-laser-features';
import { framedRunControllerSnapshot } from './framed-run';
import type { JobStartMarkRequest } from './job-start-mark';
import { connectWith } from './laser-store-motion-operation.test-support';
import { settleTestGrblHandshake } from './laser-test-start-helpers';
import { useLaserStore } from './laser-store';
import { useStore } from './store';
import { MarkWire, type MarkPort } from './laser-job-start-mark-wire.test-support';
import { reportedWorkPositionMm } from './canvas-motion-plan';

export type { MarkPort } from './laser-job-start-mark-wire.test-support';

export async function readyMarkPort(observedMaxS = 1000): Promise<MarkPort> {
  installFrameOnceProject();
  const project = useStore.getState().project;
  useStore.setState({
    project: {
      ...project,
      device: {
        ...project.device,
        capabilities: [...(project.device.capabilities ?? []), 'low-power-fire'],
        fireControl: { enabled: true, maxPowerPercent: 5 },
        maxPowerS: 1000,
        framingFeedMmPerMin: 1000,
      },
    },
  });
  useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);
  const wire = new MarkWire();
  await connectWith(wire.port.connection);
  await settleTestGrblHandshake();
  wire.ready = true;
  const epoch = useLaserStore.getState().controllerSessionEpoch;
  useLaserStore.setState({
    controllerSettings: { maxPowerS: observedMaxS, minPowerS: 0, laserModeEnabled: true },
    controllerSettingsObservation: { sessionEpoch: epoch, observedAt: Date.now() },
  });
  wire.port.connection.emitLine('[GC:G0 G54 G17 G21 G90 G94 M5 M9 T0 F0 S0]');
  wire.port.emitStatus();
  wire.port.writes.length = 0;
  return wire.port;
}

export async function prepareMarkRequest(withFrame = true): Promise<JobStartMarkRequest> {
  const frame = withFrame ? await installReviewPendingFramedRunPermitForCurrentState() : null;
  const laser = useLaserStore.getState();
  const prepared = await prepareCurrentStartJob(
    useStore.getState(),
    laser,
    useCameraStore.getState(),
    frame?.candidate.preparedStart.jobOrigin,
    false,
  );
  if (!prepared.ok) throw new Error(prepared.messages.join(' '));
  const initialPosition = reportedWorkPositionMm(
    laser,
    laser.controllerSettings?.reportInches === true,
  );
  if (initialPosition === null)
    throw new Error('The fake mark port needs its initial work position.');
  return {
    prepared,
    controller: framedRunControllerSnapshot(laser),
    connectionAttempt: laser.connectionAttempt,
    initialPosition,
    frame,
  };
}

export async function waitForMark(predicate: () => boolean, timeoutMs = 250): Promise<void> {
  const step = timeoutMs > 250 ? 50 : 1;
  for (let elapsed = 0; elapsed < timeoutMs && !predicate(); elapsed += step) {
    await vi.advanceTimersByTimeAsync(step);
  }
  expect(predicate()).toBe(true);
}

export async function finishMark(promise: Promise<void>): Promise<void> {
  let settled = false;
  const outcome = promise.then(
    () => {
      settled = true;
    },
    (error: unknown) => {
      settled = true;
      throw error;
    },
  );
  void outcome.catch(() => undefined);
  for (let tick = 0; tick < 2000 && !settled; tick += 1) await vi.advanceTimersByTimeAsync(50);
  expect(settled).toBe(true);
  await outcome;
}
