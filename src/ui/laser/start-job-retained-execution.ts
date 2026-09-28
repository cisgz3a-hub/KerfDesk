import type { JobInterruption } from '../../core/recovery';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { settledCleanly } from '../state/post-job-clean-settle';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import {
  completeUnarchivedRun,
  releaseUnarchivedRun,
  rememberUnarchivedRun,
} from '../state/laser-unarchived-run';
import type { ExecutionArtifactV1, RecoveryRepository, RunId } from '../state/recovery';
import { freshRunOwnershipMatches } from '../state/recovery/fresh-run-ownership';
import { currentJobStopRequest } from '../state/job-stop-request';
import {
  checkpointInterruption,
  currentRunPlannerBacklog,
  runStopMayHaveLostPosition,
} from '../app/checkpoint-interruption';
import { disappearedStreamInterruption } from '../app/job-checkpoint-repository';

type Terminal =
  | { readonly kind: 'completed' }
  | {
      readonly kind: 'interrupted';
      readonly ackedLines: number;
      readonly interruption: JobInterruption;
      readonly at: string;
    };

/** Observe before the first write: a short run can settle or fail before its
 * archive activation answers. Later retention must preserve that exact outcome. */
export function observeFreshExecutionRetention(runId: RunId, repository: RecoveryRepository) {
  let superseded = false;
  let ended: Terminal | null = null;
  const before = repository.getSnapshot();
  const current = (): boolean =>
    !superseded && freshRunOwnershipMatches(repository.getSnapshot(), before, runId);
  const unsubscribe = useLaserStore.subscribe((state, previous) => {
    if (
      state.activeRunId !== null &&
      state.activeRunId !== runId &&
      state.activeRunId !== previous.activeRunId
    ) {
      superseded = true;
    }
    if (ended?.kind === 'interrupted') return;
    const terminal = observedTerminal(runId, state, previous);
    if (terminal !== null) ended = terminal;
  });
  return {
    current,
    retain: (build: (() => ExecutionArtifactV1) | null): void => {
      if (!current()) return;
      rememberUnarchivedRun(runId, build === null ? null : async () => build());
      if (ended?.kind === 'interrupted') releaseUnarchivedRun(runId);
    },
    settle: async (): Promise<void> => {
      if (!current()) {
        releaseUnarchivedRun(runId);
        return;
      }
      await settleRetainedExecution(runId, ended, repository);
    },
    stop: unsubscribe,
  };
}

function observedTerminal(runId: RunId, state: LaserState, previous: LaserState): Terminal | null {
  if (state.activeRunId === runId && state.streamer !== null) {
    const streamer = state.streamer;
    const interruption = checkpointInterruption(
      streamer.status,
      state.safetyNotice,
      currentJobStopRequest(state),
      currentRunPlannerBacklog(state),
      runStopMayHaveLostPosition(state),
      Math.min(streamer.total, streamer.completed + streamer.inFlight.length),
    );
    if (interruption !== null) return interrupted(streamer.completed, interruption);
  }
  if (previous.activeRunId !== runId || previous.streamer === null || state.streamer !== null)
    return null;
  return settledCleanly(state, previous, previous.streamer.status)
    ? { kind: 'completed' }
    : interrupted(
        previous.streamer.completed,
        disappearedStreamInterruption(previous.streamer.status, state),
      );
}

function interrupted(ackedLines: number, interruption: JobInterruption): Terminal {
  return { kind: 'interrupted', ackedLines, interruption, at: new Date().toISOString() };
}

async function settleRetainedExecution(
  runId: RunId,
  ended: Terminal | null,
  repository: RecoveryRepository,
): Promise<void> {
  if (ended !== null) await repository.finishUnarchivedStart(runId, ended.kind === 'completed');
  if (ended?.kind === 'completed' && completeUnarchivedRun(runId)) {
    // The tracker may have announced a staged terminal already. This offer
    // remains idempotent and still requires the same physical clean-settle proof.
    useLaserSecondPassUiStore.getState().offerCompletion(runId);
  }
  if (ended?.kind === 'interrupted') {
    // Failed activation can discard a deferred terminal. Hand its first
    // observed stop to the short record now, idempotently for this run only.
    await repository.interruptRun(runId, ended.ackedLines, ended.interruption, ended.at);
  }
}

export type FreshExecutionRetention = ReturnType<typeof observeFreshExecutionRetention>;
