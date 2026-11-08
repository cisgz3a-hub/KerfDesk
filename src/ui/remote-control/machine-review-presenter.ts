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

/** Why a remote cannot approve while the PC's review has a card mid-edit. */
export const REVIEW_EDITING_MESSAGE =
  'A setting is being edited in the Job Review on the PC. Save or discard it there, then approve the new review.';

/** Why a remote cannot approve while the PC's review asks the machine type. */
export const REVIEW_MACHINE_TYPE_MESSAGE =
  'The Job Review on the PC asks whether this machine is a laser. Answer it there, then approve the new review.';

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
      const editing = current.editingOperationIds.size > 0;
      const asking = current.state.model.convertedLaser !== undefined;
      if (heldForPreparation(operation, current.state, current.pendingSignal, editing, asking))
        return;
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
// Preparing, blocked or cancelled, or a card mid-edit on the PC: the remote has
// nothing to approve. Start waits for an unsaved edit (ADR-638) because the job
// must run only the values the review shows. A machine-type question waits for
// the PC too: only its owner can say whether the machine is a laser (ADR-637
// Amendment 8).
function heldForPreparation(
  operation: OwnedMachineOperation,
  state: Extract<JobReviewState, { readonly kind: 'open' }>,
  signal: JobReviewSignal | null,
  editing: boolean,
  asking: boolean,
): boolean {
  const blocked = preparationBlocked(state, signal);
  if (!blocked && !editing && !asking) return false;
  delete operation.review;
  operation.state = 'preparing';
  if (blocked && state.blocker !== null) {
    operation.message = state.blocker.join('\n');
    operation.privateMessage = true;
  } else if (!blocked) {
    operation.message = asking ? REVIEW_MACHINE_TYPE_MESSAGE : REVIEW_EDITING_MESSAGE;
    delete operation.privateMessage;
  }
  return true;
}
function preparationBlocked(
  state: Extract<JobReviewState, { readonly kind: 'open' }>,
  signal: JobReviewSignal | null,
): boolean {
  return state.isPreparing || state.blocker !== null || signal === 'cancel';
}
