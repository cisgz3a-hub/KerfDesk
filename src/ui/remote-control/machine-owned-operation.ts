import { useLaserStore } from '../state/laser-store';
import { useJobReviewStore } from '../laser/job-review/job-review-store';
import { operationIsTerminal, type OwnedMachineOperation } from './machine-operation-state';
import type { MachineAuthority, MachineCommand } from './machine-types';
import type { RemoteAppStore } from './types';
import { RemoteFault } from './fault';

export type MachineAction = Exclude<
  MachineCommand,
  { readonly command: 'get_machine_status' | 'get_control_operation' }
>;
export type BackgroundMachineAction = Exclude<MachineAction, { readonly command: 'start_job' }>;

export function assertMachineOperationOwned(
  operation: OwnedMachineOperation,
  store: RemoteAppStore,
  disposed: boolean,
): void {
  if (disposed || operation.controller.signal.aborted) throw new RemoteFault('cancelled');
  operation.authority.assertCurrent();
  const documentChanged =
    operation.kind !== 'abort' && store.getState().projectDocumentEpoch !== operation.documentEpoch;
  if (
    documentChanged ||
    useLaserStore.getState().controllerSessionEpoch !== operation.controllerEpoch
  )
    throw new RemoteFault('stale_revision');
}
export function cancelMachineOperation(operation: OwnedMachineOperation, stopMotion = true): void {
  if (operationIsTerminal(operation) || (operation.kind === 'job' && operation.committed !== false))
    return;
  operation.controller.abort();
  delete operation.review;
  const state = useLaserStore.getState();
  const motion = state.motionOperation;
  if (
    !stopMotion ||
    operation.motionId === undefined ||
    state.controllerSessionEpoch !== operation.controllerEpoch ||
    motion?.operationId !== operation.motionId
  )
    return;
  // Close further legs before asynchronous ordinary Cancel. Never stop another owner.
  useLaserStore.setState({ motionOperation: { ...motion, cancelRequested: true } });
  // Synchronous subscribers may replace the connection or motion during publication.
  const current = useLaserStore.getState();
  if (!ownsCurrentMotion(current, operation)) return;
  void current.cancelJog().catch(() => {
    operation.state = 'unknown';
    operation.message = 'Motion cancellation could not be confirmed. Check the machine on the PC.';
  });
}
function ownsCurrentMotion(
  state: ReturnType<typeof useLaserStore.getState>,
  operation: OwnedMachineOperation,
): boolean {
  return (
    state.controllerSessionEpoch === operation.controllerEpoch &&
    state.motionOperation?.operationId === operation.motionId
  );
}
export function ownMachineOperation(
  input: MachineAction,
  authority: MachineAuthority,
  store: RemoteAppStore,
  revision: () => string,
): OwnedMachineOperation {
  const kind =
    input.command === 'jog_machine'
      ? 'jog'
      : input.command === 'frame_job'
        ? 'frame'
        : input.command === 'abort_job'
          ? 'abort'
          : 'job';
  const operation: OwnedMachineOperation = {
    authority,
    controller: new AbortController(),
    documentEpoch: store.getState().projectDocumentEpoch,
    controllerEpoch: useLaserStore.getState().controllerSessionEpoch,
    kind,
    state: 'accepted',
    committed: false,
    cleanup: () => undefined,
  };
  const revoked = () => cancelMachineOperation(operation);
  authority.signal.addEventListener('abort', revoked, { once: true });
  const unsubscribe = store.subscribe(() => {
    if (
      operation.kind !== 'abort' &&
      store.getState().projectDocumentEpoch !== operation.documentEpoch
    ) {
      cancelMachineOperation(operation);
      return;
    }
    const review = operation.review;
    if (
      review !== undefined &&
      review.revision !== revision() &&
      useJobReviewStore.getState().requestOwner === review.presentation.requestOwner
    )
      useJobReviewStore.getState().requestRebuild();
  });
  operation.cleanup = () => {
    authority.signal.removeEventListener('abort', revoked);
    unsubscribe();
  };
  return operation;
}
export function recordMachineOperationFailure(
  operation: OwnedMachineOperation,
  error: unknown,
): void {
  const preDispatchCancelled = operation.controller.signal.aborted && operation.committed === false;
  operation.state = preDispatchCancelled
    ? 'cancelled'
    : operation.committed !== false
      ? 'unknown'
      : 'failed';
  operation.message =
    error instanceof RemoteFault
      ? error.message
      : operation.controller.signal.aborted
        ? 'The owned operation was cancelled.'
        : 'This operation could not complete. Check the machine on the PC.';
}
export function currentMachineReviewForApproval(
  operation: OwnedMachineOperation,
  revision: string,
): NonNullable<OwnedMachineOperation['review']> {
  const review = operation.review;
  const current = useJobReviewStore.getState();
  if (
    review === undefined ||
    review.revision !== revision ||
    current.requestOwner !== review.presentation.requestOwner
  )
    throw new RemoteFault('stale_revision');
  if (
    current.state.kind !== 'open' ||
    current.state.isPreparing ||
    current.state.blocker !== null ||
    current.state.model !== review.model
  )
    throw new RemoteFault('stale_revision');
  return review;
}
