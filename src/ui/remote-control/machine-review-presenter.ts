import {
  createJobReviewPresentation,
  type JobReviewPresenter,
} from '../laser/job-review/job-review-presentation';
import {
  useJobReviewStore,
  type JobReviewState,
  type JobReviewSignal,
} from '../laser/job-review/job-review-store';
import type { OwnedMachineOperation } from './machine-operation-state';
import type { RemoteControlOptions } from './types';
import { reviewMessageProjector } from './review-message-sharing';

/** Approval names exactly one displayed ordinary review owner and model. */
export function machineReviewPresenter(
  operation: OwnedMachineOperation,
  revision: () => string,
  options: RemoteControlOptions,
): JobReviewPresenter {
  return (model, purpose) => {
    const native = createJobReviewPresentation(model, purpose, operation.controller.signal);
    if (native === null) return null;
    let confirmedModel = null as typeof model | null;
    let displayedModel = model;
    let displayedRevision = revision();
    const presentation = {
      ...native,
      confirm: () => {
        const current = useJobReviewStore.getState();
        if (current.requestOwner !== native.requestOwner || current.state.kind !== 'open') return;
        confirmedModel = current.state.model;
        delete operation.review;
        operation.state = 'starting';
        native.confirm();
      },
    };
    const publish = (): void => {
      const current = useJobReviewStore.getState();
      if (current.requestOwner !== presentation.requestOwner || current.state.kind !== 'open') {
        delete operation.review;
        return;
      }
      if (current.pendingSignal === 'confirm') {
        delete operation.review;
        operation.state = 'starting';
        return;
      }
      if (preparationBlocked(current.state, current.pendingSignal)) {
        delete operation.review;
        operation.state = 'preparing';
        if (current.state.blocker !== null) {
          operation.message = current.state.blocker.join('\n');
          operation.privateMessage = true;
        }
        return;
      }
      if (current.state.model !== displayedModel) {
        displayedModel = current.state.model;
        displayedRevision = revision();
      }
      // A revision changed before the canonical rebuild starts: do not attach
      // a fresh revision/token to the old displayed program in that boundary.
      if (displayedRevision !== revision()) {
        delete operation.review;
        operation.state = 'preparing';
        return;
      }
      if (current.state.model === confirmedModel) return;
      if (
        operation.review?.model === current.state.model &&
        operation.review.revision === revision()
      )
        return;
      operation.review = {
        id: crypto.randomUUID(),
        revision: revision(),
        model: current.state.model,
        presentation,
        projectPrivateMessage: reviewMessageProjector({ ...options, canShareArtwork: () => false }),
      };
      operation.state = 'awaiting_review';
      delete operation.message;
      delete operation.privateMessage;
    };
    const unsubscribe = useJobReviewStore.subscribe(publish);
    publish();
    return {
      ...presentation,
      dispose: () => {
        unsubscribe();
        delete operation.review;
        presentation.dispose();
      },
    };
  };
}
function preparationBlocked(
  state: Extract<JobReviewState, { readonly kind: 'open' }>,
  signal: JobReviewSignal | null,
): boolean {
  return state.isPreparing || state.blocker !== null || signal === 'cancel';
}
