// Test seams for the Job Review gate (ADR-224), used by flow tests that
// drive Start end-to-end without rendering the dialog.
//
// installAutoJobReview answers the review the moment the gate opens it; a
// choice function lets one beforeEach installation serve tests that confirm
// and tests that cancel. The answer lands on a microtask so the gate has
// armed its signal waiter first; a pre-arm answer is still safe because the
// store holds it as a pending signal.

import { useJobReviewStore } from './job-review-store';
import type { JobReviewModel } from './job-review-model';

type JobReviewChoice = 'confirm' | 'cancel';

export function installAutoJobReview(
  choice: JobReviewChoice | (() => JobReviewChoice),
): () => void {
  const resolveChoice = typeof choice === 'function' ? choice : (): JobReviewChoice => choice;
  const answer = (): void => {
    queueMicrotask(() => {
      const store = useJobReviewStore.getState();
      if (store.state.kind !== 'open') return;
      if (resolveChoice() === 'confirm') store.confirm();
      else store.cancel();
    });
  };
  const unsubscribe = useJobReviewStore.subscribe((store, previous) => {
    if (store.state.kind === 'open' && previous.state.kind !== 'open') answer();
  });
  if (useJobReviewStore.getState().state.kind === 'open') answer();
  return unsubscribe;
}

/** Records every model the gate publishes (initial open + each re-prepare)
 * so tests can assert what the operator was shown; the store empties on
 * close, so capture must happen while the flow runs. */
export function captureJobReviewModels(): {
  readonly models: ReadonlyArray<JobReviewModel>;
  readonly stop: () => void;
} {
  const models: JobReviewModel[] = [];
  const stop = useJobReviewStore.subscribe((store, previous) => {
    if (store.state.kind !== 'open') return;
    if (previous.state.kind !== 'open' || store.state.model !== previous.state.model) {
      models.push(store.state.model);
    }
  });
  return { models, stop };
}
