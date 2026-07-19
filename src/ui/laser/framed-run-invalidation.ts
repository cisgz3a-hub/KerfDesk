import { createStore } from 'zustand/vanilla';
import { useCameraStore } from '../state/camera-store';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { isStampedStartRun } from '../state/framed-run-interruption';
import { framedRunReadinessIssue } from './framed-run-readiness';

type InvalidationLifecycle = { readonly owner: symbol | null };

const invalidationLifecycle = createStore<InvalidationLifecycle>(() => ({ owner: null }));

/**
 * Make permit expiry one-way. Deterministic equality checks still explain why
 * a permit is stale, while these subscriptions consume it at the first drift
 * so changing the project/environment away and back cannot resurrect an old
 * physical Frame.
 */
export function ensureFramedRunInvalidationSubscriptions(): void {
  const owner = Symbol('framed-run-invalidation');
  invalidationLifecycle.setState((state) => (state.owner === null ? { owner } : state));
  if (invalidationLifecycle.getState().owner !== owner) return;
  const expireIfOwned = (): void => expireCurrentPermitIfNeeded(owner);
  useStore.subscribe(expireIfOwned);
  useCameraStore.subscribe(expireIfOwned);
  useExperimentalLaserFeatures.subscribe(expireIfOwned);
  usePrintCutSessionStore.subscribe(expireIfOwned);
  useLaserStore.subscribe(expireIfOwned);
}

function expireCurrentPermitIfNeeded(owner: symbol): void {
  if (invalidationLifecycle.getState().owner !== owner) return;
  const laser = useLaserStore.getState();
  const permit = laser.framedRun;
  if (permit === null) return;
  const expectedStartRun = isStampedStartRun(laser, laser.statusReport);
  if (
    !transientMachineActivity(laser, expectedStartRun) &&
    framedRunReadinessIssue(permit, undefined, laser, undefined, {
      ignoreControllerStatusState: expectedStartRun,
    }) === null
  ) {
    return;
  }
  useLaserStore.setState((current) =>
    current.framedRun === permit ? { framedRun: null, frameVerification: null } : {},
  );
}

function transientMachineActivity(
  laser: ReturnType<typeof useLaserStore.getState>,
  expectedStartRun: boolean,
): boolean {
  return (
    laser.autofocusBusy ||
    laser.motionOperation !== null ||
    isActiveJob(laser.streamer) ||
    laser.alarmCode !== null ||
    (!expectedStartRun && laser.statusReport?.state !== 'Idle') ||
    laser.mpgActive === true
  );
}
