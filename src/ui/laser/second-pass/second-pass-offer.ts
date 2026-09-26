import { laserSecondPassSupportsController } from '../../../core/laser-second-pass/source-family';
import type { LaserState } from '../../state/laser-store';
import type { ExecutionArtifactV1, RecoveryRepositorySnapshot } from '../../state/recovery';

/** Only a flat laser run whose program the transformer can read is offered;
 * a CNC, Marlin or Smoothieware completion would lead straight to a refusal. */
export function secondPassOfferable(artifact: ExecutionArtifactV1): boolean {
  return (
    artifact.machineKind === 'laser' &&
    laserSecondPassSupportsController(artifact.prepared.project.device.controllerKind)
  );
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
