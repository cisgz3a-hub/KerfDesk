import type { ReviewedStartBundle } from './job-review-gate';
import type { JobReviewModel } from './job-review-model';
import { useJobReviewStore } from './job-review-store';

type OwnedReviewSnapshot = {
  readonly owner: symbol;
  readonly bundle: ReviewedStartBundle;
  readonly model: JobReviewModel;
  readonly machineInputsKey: string;
};
let snapshot: OwnedReviewSnapshot | null = null;

/** Publish only the exact bundle whose model the existing desktop owner displays. */
export function publishReviewedJobSnapshot(
  bundle: ReviewedStartBundle,
  model: JobReviewModel,
): symbol | null {
  const current = useJobReviewStore.getState();
  if (
    current.requestOwner === null ||
    current.state.kind !== 'open' ||
    current.state.model !== model ||
    current.state.isPreparing ||
    current.state.blocker !== null ||
    bundle.preparedMachineInputsKey === undefined
  )
    return null;
  snapshot = {
    owner: current.requestOwner,
    bundle,
    model,
    machineInputsKey: bundle.preparedMachineInputsKey,
  };
  return current.requestOwner;
}

/** This observer cannot confirm, rebuild, prepare, execute or mutate the desktop job. */
export function currentReviewedJobSnapshot(): OwnedReviewSnapshot | null {
  const current = useJobReviewStore.getState();
  if (
    snapshot === null ||
    current.requestOwner !== snapshot.owner ||
    current.state.kind !== 'open' ||
    current.state.model !== snapshot.model ||
    current.state.isPreparing ||
    current.state.blocker !== null ||
    current.pendingSignal === 'cancel'
  )
    return null;
  return snapshot;
}

export function clearReviewedJobSnapshot(owner: symbol | null): void {
  if (snapshot?.owner === owner) snapshot = null;
}
