import { createStore } from 'zustand/vanilla';
import { useLaserStore } from '../state/laser-store';
import { isActiveJob } from '../state/laser-store-helpers';
import { useStore } from '../state/store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { isStampedStartRun } from '../state/framed-run-interruption';
import type { FrameTrace } from '../state/framed-run';
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
  useExperimentalLaserFeatures.subscribe(expireIfOwned);
  usePrintCutSessionStore.subscribe(expireIfOwned);
  useLaserStore.subscribe(expireIfOwned);
}

function expireCurrentPermitIfNeeded(owner: symbol): void {
  if (invalidationLifecycle.getState().owner !== owner) return;
  const laser = useLaserStore.getState();
  expireStalePermit(laser);
  expireStaleTrace(laser);
}

function expireStalePermit(laser: ReturnType<typeof useLaserStore.getState>): void {
  const permit = laser.framedRun;
  if (permit === null) return;
  const expectedStartRun = isStampedStartRun(laser, laser.statusReport);
  if (
    !transientMachineActivity(laser, expectedStartRun) &&
    framedRunReadinessIssue(permit, undefined, laser, {
      ignoreControllerStatusState: expectedStartRun,
    }) === null
  ) {
    return;
  }
  useLaserStore.setState((current) =>
    current.framedRun === permit ? { framedRun: null, frameVerification: null } : {},
  );
}

/** A trace awaiting its exact program expires exactly as a permit would: any
 * transient activity or drift since its clean completion ends it, so the
 * program can never be bound to an outline the machine no longer stands on
 * (ADR-353). */
function expireStaleTrace(laser: ReturnType<typeof useLaserStore.getState>): void {
  const trace = laser.frameTrace ?? null;
  if (trace === null) return;
  if (!transientMachineActivity(laser, false) && frameTraceReadinessIssue(trace, laser) === null) {
    return;
  }
  useLaserStore.setState((current) => (current.frameTrace === trace ? { frameTrace: null } : {}));
}

/** Readiness of a trace for binding its exact program: the permit rule, with
 * no Start-run exemption because no Start can own a trace. */
export function frameTraceReadinessIssue(
  trace: FrameTrace,
  laser: ReturnType<typeof useLaserStore.getState> = useLaserStore.getState(),
): string | null {
  return framedRunReadinessIssue(trace, undefined, laser);
}

/** True while the machine is doing, or reporting, anything other than a
 * settled Idle. Exported so the Frame flow can refuse to mint a permit in the
 * same conditions that would have expired it a moment later. */
export function transientMachineActivity(
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
