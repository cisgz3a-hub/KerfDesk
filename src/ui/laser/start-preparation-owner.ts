import { useStore } from '../state/store';
import { useLaserStore } from '../state/laser-store';
import { useExperimentalLaserFeatures } from '../state/experimental-laser-features';
import { usePrintCutSessionStore } from '../state/print-cut-session-store';
import { controllerStartPreparationStillCurrent } from './start-job-authorization';
import { currentReplayExecutionSignature } from './start-job-execution-tracking';

export const STALE_START_PREPARATION_MESSAGE =
  'The job or machine setup changed during preparation. Preparation was cancelled; try again with the current job.';

/**
 * Retire a preparation when its existing exact-handoff identity becomes
 * stale. Advisory controller settings do not cancel work or become a gate.
 * Each owner detaches on settlement and aborts only its own worker request.
 */
export function ownCurrentStartPreparation(
  app: ReturnType<typeof useStore.getState>,
  laser: ReturnType<typeof useLaserStore.getState>,
  callerSignal?: AbortSignal,
): {
  readonly signal: AbortSignal;
  readonly inputsChanged: () => boolean;
  readonly dispose: () => void;
} {
  const controller = new AbortController();
  const signature = currentReplayExecutionSignature(app);
  let changed = false;
  const cancel = (): void => controller.abort();
  const invalidate = (): void => {
    changed = true;
    cancel();
  };
  const observeProject = (): void => {
    if (currentReplayExecutionSignature() !== signature) invalidate();
  };
  const observeController = (): void => {
    if (
      !controllerStartPreparationStillCurrent(laser, useLaserStore.getState(), {
        ignoreAdvisoryControllerEvidence: true,
      })
    )
      invalidate();
  };
  const subscriptions = [
    useStore.subscribe(observeProject),
    useExperimentalLaserFeatures.subscribe(observeProject),
    usePrintCutSessionStore.subscribe(observeProject),
    useLaserStore.subscribe(observeController),
  ];
  callerSignal?.addEventListener('abort', cancel, { once: true });
  if (callerSignal?.aborted === true) cancel();
  observeProject();
  observeController();
  return {
    signal: controller.signal,
    inputsChanged: () => changed,
    dispose: () => {
      subscriptions.forEach((unsubscribe) => unsubscribe());
      callerSignal?.removeEventListener('abort', cancel);
    },
  };
}
