import type { ControllerKind } from '../../../core/devices';
import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import type { MachineKind } from '../../../core/scene';
import type { LaserState } from '../../state/laser-store';
import {
  selectCompletedUnarchivedRun,
  useUnarchivedRunStore,
} from '../../state/laser-unarchived-run';
import type {
  ExecutionArtifactV1,
  RecoveryRepository,
  RecoveryRepositorySnapshot,
} from '../../state/recovery';
import { useRecoveryRepositorySelection } from '../../state/use-recovery-repository';

/** Only a flat laser run whose program the transformer can read is offered;
 * a CNC, Marlin or Smoothieware completion would lead straight to a refusal. */
export function secondPassOfferable(artifact: ExecutionArtifactV1): boolean {
  return secondPassOfferableFor(
    artifact.machineKind,
    artifact.prepared.project.device.controllerKind,
  );
}

export function secondPassOfferableFor(
  machineKind: MachineKind,
  controllerKind: ControllerKind | undefined,
): boolean {
  return machineKind === 'laser' && laserSecondPassSupportsController(controllerKind);
}

/** The job that just finished, when a second pass can be offered for it: the
 * archived receipt, or a run too large for the archive that this page kept in
 * memory (ADR-341 Amendment 7). A new Start clears whichever one exists. */
export function useJustFinishedSecondPassRun(
  repository: RecoveryRepository,
): { readonly runId: string; readonly unarchived: boolean } | null {
  const receipt = useRecoveryRepositorySelection(selectLastCompletedReceipt, repository);
  const unarchived = useUnarchivedRunStore(selectCompletedUnarchivedRun);
  if (receipt !== null && secondPassOfferable(receipt.artifact)) {
    return { runId: receipt.runId, unarchived: false };
  }
  return unarchived === null ? null : { runId: unarchived.runId, unarchived: true };
}

/** The one job a second pass is offered for: the last run, when it completed.
 * A later interrupted run clears this receipt, so an older completion is never
 * offered in its place (ADR-341 Amendment 4). */
export function selectLastCompletedReceipt(snapshot: RecoveryRepositorySnapshot) {
  return snapshot.lastCompletedReceipt;
}

/** Another run holds the controller: a stream exists for a run other than
 * `runId` and has not ended in an abort or disconnect. An aborted run keeps its
 * cancelled stream and activeRunId until the next Start, so activeRunId alone
 * is not evidence that a newer run began (ADR-341 Amendment 4). */
export function anotherRunHoldsTheStream(
  state: Pick<LaserState, 'activeRunId' | 'streamer'>,
  runId: string,
): boolean {
  const status = state.streamer?.status;
  return (
    status !== undefined &&
    status !== 'cancelled' &&
    status !== 'disconnected' &&
    state.activeRunId !== runId
  );
}

/** The completion prompt's view of `runId`: offered when it is the job that
 * just finished, refused when its receipt names a run no second pass can
 * read, and kept only in this page when the archive could not hold it. */
export function useCompletionOffer(
  runId: string | null,
  repository: RecoveryRepository,
): { readonly offerable: boolean; readonly refused: boolean; readonly unarchived: boolean } {
  const receipt = useRecoveryRepositorySelection(selectLastCompletedReceipt, repository);
  const finished = useJustFinishedSecondPassRun(repository);
  const offerable = runId !== null && finished?.runId === runId;
  return {
    offerable,
    refused: runId !== null && receipt?.runId === runId && !offerable,
    unarchived: offerable && finished.unarchived,
  };
}
