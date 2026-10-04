import { ownJobReviewPreparation } from './job-review-preparation-owner';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore, type JobReviewPurpose, type JobReviewSignal } from './job-review-store';

export type JobReviewPresentation = {
  readonly requestOwner: symbol;
  readonly signal: AbortSignal;
  readonly nextSignal: () => Promise<JobReviewSignal>;
  readonly beginPrepare: () => void;
  readonly completePrepare: (model: JobReviewModel) => void;
  readonly failPrepare: (messages: readonly string[]) => void;
  readonly confirm: () => void;
  readonly close: () => void;
  readonly dispose: () => void;
};
export type JobReviewPresenter = (
  model: JobReviewModel,
  purpose: JobReviewPurpose,
) => JobReviewPresentation | null;

/** Both local and remote presentation reserve the same ordinary review owner. */
export function createJobReviewPresentation(
  model: JobReviewModel,
  purpose: JobReviewPurpose,
  signal?: AbortSignal,
): JobReviewPresentation | null {
  if (signal?.aborted === true || !useJobReviewStore.getState().open(model, purpose)) return null;
  const requestOwner = useJobReviewStore.getState().requestOwner;
  if (requestOwner === null) return null;
  const owner = ownJobReviewPreparation();
  const owns = () => useJobReviewStore.getState().requestOwner === requestOwner;
  const close = () => {
    if (owns()) useJobReviewStore.getState().cancelAndClose();
  };
  signal?.addEventListener('abort', close, { once: true });
  return {
    requestOwner,
    signal: owner.signal,
    nextSignal: owner.nextSignal,
    beginPrepare: () => {
      if (owns()) useJobReviewStore.getState().beginPrepare();
    },
    completePrepare: (next) => {
      if (owns()) useJobReviewStore.getState().completePrepare(next);
    },
    failPrepare: (messages) => {
      if (owns()) useJobReviewStore.getState().failPrepare(messages);
    },
    confirm: () => {
      if (owns()) useJobReviewStore.getState().confirm();
    },
    close,
    dispose: () => {
      signal?.removeEventListener('abort', close);
      owner.dispose();
    },
  };
}
