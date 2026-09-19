import { useJobReviewStore, type JobReviewSignal } from './job-review-store';

/** Cancellation owns only this review's preparation, including queued work. */
export function ownJobReviewPreparation(): {
  readonly signal: AbortSignal;
  readonly nextSignal: () => Promise<JobReviewSignal>;
  readonly dispose: () => void;
} {
  const owner = useJobReviewStore.getState().requestOwner;
  const controller = new AbortController();
  const observe = (): void => {
    const current = useJobReviewStore.getState();
    if (
      current.requestOwner !== owner ||
      current.state.kind !== 'open' ||
      current.pendingSignal === 'cancel'
    ) {
      controller.abort();
    }
  };
  const unsubscribe = useJobReviewStore.subscribe(observe);
  observe();
  return {
    signal: controller.signal,
    nextSignal: () => {
      if (controller.signal.aborted) return Promise.resolve('cancel');
      return new Promise((resolve) => {
        const cancel = (): void => resolve('cancel');
        controller.signal.addEventListener('abort', cancel, { once: true });
        void useJobReviewStore
          .getState()
          .nextSignal()
          .then((signal) => {
            controller.signal.removeEventListener('abort', cancel);
            resolve(signal);
          });
      });
    },
    dispose: () => {
      unsubscribe();
      if (useJobReviewStore.getState().requestOwner === owner) useJobReviewStore.getState().close();
    },
  };
}
