// Run-owned recovery tracking. Exact G-code lives once in IndexedDB; this hook
// advances only the active runId's small slot record and promotes terminal
// streams to the isolated newest-only recovery capsule. Completion is recorded
// only after the acknowledged stream has settled to fresh physical Idle.

import { useEffect } from 'react';
import type { StreamerState, StreamerStatus } from '../../core/controllers/grbl';
import type { JobInterruption } from '../../core/recovery';
import { recoveryRepository, type RecoveryRepository, type RunId } from '../state/recovery';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { CHECKPOINT_ACK_INTERVAL_LINES } from '../state/job-checkpoint-storage';
import { currentJobStopRequest } from '../state/job-stop-request';
import { settledCleanly } from '../state/post-job-clean-settle';
import { useToastStore } from '../state/toast-store';
import { useLaserSecondPassUiStore } from '../state/laser-second-pass-ui-store';
import { checkpointInterruption, currentRunPlannerBacklog } from './checkpoint-interruption';
import {
  checkpointArchiveHandoffIsCurrent,
  pendingCheckpointArchiveHandoff,
  subscribeCheckpointArchiveActivation,
  type CheckpointArchiveHandoff,
} from './checkpoint-archive-handoff';

type StreamObservation = {
  readonly runId: RunId;
  readonly status: StreamerStatus;
  readonly completed: number;
};

type PendingMissingTerminal =
  | {
      readonly kind: 'completed';
      readonly runId: RunId;
      readonly settledAtIso: string;
    }
  | {
      readonly kind: 'interrupted';
      readonly runId: RunId;
      readonly ackedLines: number;
      readonly interruption: JobInterruption;
      readonly settledAtIso: string;
    };

type TrackingFailureReporter = (error: unknown) => void;

/** The one progress write allowed to wait behind the write in flight. */
type WaitingProgress = { readonly runId: RunId; ackedLines: number };

const TRACKING_FAILURE_MESSAGE =
  'Job recovery tracking hit an unexpected error. The current job is unaffected, and progress will remain eligible for retry.';

export function installJobCheckpointTracking(
  nowIso: () => string = () => new Date().toISOString(),
  repository: RecoveryRepository = recoveryRepository,
  reportTrackingFailure: TrackingFailureReporter = defaultTrackingFailureReporter,
  onCompleted: (runId: RunId) => void = useLaserSecondPassUiStore.getState().offerCompletion,
): () => void {
  let active = true;
  const tracker = new JobCheckpointTracker(nowIso, repository, reportTrackingFailure, (runId) => {
    if (active) onCompleted(runId);
  });
  tracker.sync(useLaserStore.getState());
  const unsubscribe = useLaserStore.subscribe(tracker.sync);
  const unsubscribeArchive = subscribeCheckpointArchiveActivation(
    repository,
    tracker.retryActivatedArchive,
  );
  return () => {
    active = false;
    unsubscribe();
    unsubscribeArchive();
  };
}

function defaultTrackingFailureReporter(_error: unknown): void {
  useToastStore.getState().pushToast(TRACKING_FAILURE_MESSAGE, 'warning');
}

class JobCheckpointTracker {
  private previous: StreamObservation | null = null;
  private watermarkRunId: RunId | null = null;
  private lastPersistedAck = 0;
  private highestQueuedAck = 0;
  private terminalQueued = false;
  private pendingMissingTerminal: PendingMissingTerminal | null = null;
  private queuedMissingTerminal: PendingMissingTerminal | null = null;
  private deferredArchiveHandoff: CheckpointArchiveHandoff | null = null;
  private activatedArchiveHandoff: CheckpointArchiveHandoff | null = null;
  private supersededTerminalRunId: RunId | null = null;
  private untrackedRunId: RunId | null = null;
  private waitingProgress: WaitingProgress | null = null;
  private queue: Promise<void>;
  private readonly reportQueueFailure: TrackingFailureReporter;

  constructor(
    private readonly nowIso: () => string,
    private readonly repository: RecoveryRepository,
    reportTrackingFailure: TrackingFailureReporter,
    private readonly onCompleted: (runId: RunId) => void,
  ) {
    this.reportQueueFailure = onceTrackingFailureReporter(reportTrackingFailure);
    this.queue = initialize(repository).catch(this.reportQueueFailure);
  }

  readonly sync = (state: LaserState, priorState?: LaserState): void => {
    if (state.streamer === null) this.observeMissingStreamer(state, priorState);
    else this.observeStreamer(state, state.streamer);
  };

  readonly retryActivatedArchive = (handoff: CheckpointArchiveHandoff): void => {
    this.activatedArchiveHandoff = handoff;
    const waiting = this.deferredArchiveHandoff;
    if (
      waiting?.runId !== handoff.runId ||
      waiting.generation !== handoff.generation ||
      waiting.armedAtIso !== handoff.armedAtIso
    )
      return;
    if (this.ownsTerminal(handoff.runId)) this.sync(useLaserStore.getState());
  };

  private observeMissingStreamer(state: LaserState, priorState: LaserState | undefined): void {
    if (this.previous !== null) {
      const ended = this.previous;
      this.pendingMissingTerminal = settledCleanly(state, priorState, ended.status)
        ? { kind: 'completed', runId: ended.runId, settledAtIso: this.nowIso() }
        : {
            kind: 'interrupted',
            runId: ended.runId,
            ackedLines: ended.completed,
            interruption: disappearedStreamInterruption(ended.status, state),
            settledAtIso: this.nowIso(),
          };
    }
    this.clearRunWatermarks();
    this.queueMissingTerminalSettlement();
  }

  private observeStreamer(state: LaserState, streamer: StreamerState): void {
    const runId = state.activeRunId;
    if (runId === null || runId === this.supersededTerminalRunId) {
      this.clearRunWatermarks();
      return;
    }
    if (this.previous?.runId !== runId) this.beginRun(runId);
    const statusChanged = streamer.status !== this.previous?.status;
    const interruption = checkpointInterruption(
      streamer.status,
      state.safetyNotice,
      currentJobStopRequest(state),
      currentRunPlannerBacklog(state),
    );
    this.previous = { runId, status: streamer.status, completed: streamer.completed };

    if (interruption !== null) {
      // A terminal streamer still counts the trailing oks for lines GRBL had
      // buffered. The interruption records the exact ack it saw; a progress
      // write carrying a later ack would only raise it or fail as a no-op.
      if (!this.terminalQueued) this.queueInterruption(runId, streamer.completed, interruption);
      return;
    }

    const pendingBaseline = Math.max(this.lastPersistedAck, this.highestQueuedAck);
    const due = streamer.completed - pendingBaseline >= CHECKPOINT_ACK_INTERVAL_LINES;
    const statusProgressDue = statusChanged && streamer.completed > this.highestQueuedAck;
    if (due || statusProgressDue) this.queueProgress(runId, streamer.completed);
  }

  private queueInterruption(runId: RunId, ackedLines: number, interruption: JobInterruption): void {
    this.terminalQueued = true;
    // Progress waiting ahead of a terminal must stay at the ack it had: raising
    // it after this point would let it overtake the terminal's exact ack.
    this.waitingProgress = null;
    this.enqueue(async () => {
      try {
        if (!this.terminalStillOwned(runId)) return;
        const before = this.repository.getSnapshot();
        const interrupted = await this.repository.interruptRun(
          runId,
          ackedLines,
          interruption,
          this.nowIso(),
        );
        if (interrupted.ok && interrupted.value) {
          this.clearDeferredArchiveHandoff(runId);
          return;
        }
        if (this.watermarkRunId === runId) this.terminalQueued = false;
        const handoff = this.archiveHandoffOrRetire(before, runId);
        if (this.ownsTerminal(runId) && handoff !== null) {
          this.deferredArchiveHandoff = handoff;
          if (this.repository.getSnapshot().activeRun?.runId === runId)
            this.sync(useLaserStore.getState());
          if (interrupted.ok) return;
        }
        this.reportQueueFailure(interrupted);
      } catch (error) {
        if (this.watermarkRunId === runId) this.terminalQueued = false;
        throw error;
      }
    });
  }

  private ownsTerminal(runId: RunId): boolean {
    return this.watermarkRunId === runId || this.pendingMissingTerminal?.runId === runId;
  }

  private archiveHandoffOrRetire(
    before: ReturnType<RecoveryRepository['getSnapshot']>,
    runId: RunId,
  ): CheckpointArchiveHandoff | null {
    const handoff = pendingCheckpointArchiveHandoff(
      this.repository,
      before,
      runId,
      this.activatedArchiveHandoff,
    );
    if (handoff === null && before.pendingStart?.runId === runId) {
      // A positively replaced intent must never be retried against its new
      // owner after another controller update. Current-run storage errors keep
      // their matching handoff and remain eligible for retry.
      this.retireTerminal(runId);
    }
    return handoff;
  }

  private terminalStillOwned(runId: RunId): boolean {
    if (runId === this.supersededTerminalRunId) return false;
    const pending = this.deferredArchiveHandoff;
    if (
      pending?.runId !== runId ||
      checkpointArchiveHandoffIsCurrent(this.repository, pending, this.activatedArchiveHandoff)
    )
      return true;
    this.retireTerminal(runId);
    return false;
  }

  private retireTerminal(runId: RunId): void {
    this.supersededTerminalRunId = runId;
    this.clearDeferredArchiveHandoff(runId);
    if (this.pendingMissingTerminal?.runId === runId) this.pendingMissingTerminal = null;
    if (this.watermarkRunId === runId) this.clearRunWatermarks();
  }

  private clearDeferredArchiveHandoff(runId: RunId): void {
    if (this.deferredArchiveHandoff?.runId === runId) this.deferredArchiveHandoff = null;
  }

  private queueProgress(runId: RunId, queuedAck: number): void {
    // ADR-337 archives after acceptance. Until activation, the pending intent
    // owns this run and updateProgress has no active slot to advance yet.
    if (progressDeferredOrSettled(this.repository, runId, queuedAck)) return;
    // A run the repository does not own (untracked Start, another window,
    // Forget) answers every write with a no-op. Stay quiet until it activates
    // instead of chaining read-write transactions for the rest of the job.
    if (runId === this.untrackedRunId && !activeInRepository(this.repository, runId)) return;
    // A failed or no-op write keeps its ack queued-high: the next attempt waits
    // for the next interval, so failure never writes faster than success.
    this.highestQueuedAck = Math.max(this.highestQueuedAck, queuedAck);
    const waiting = this.waitingProgress;
    if (waiting?.runId === runId) {
      // Overwrite the one write still waiting rather than queueing another: a
      // slow disk then lags by one transaction, never by a backlog.
      waiting.ackedLines = Math.max(waiting.ackedLines, queuedAck);
      return;
    }
    const slot: WaitingProgress = { runId, ackedLines: queuedAck };
    this.waitingProgress = slot;
    this.enqueue(() => {
      if (this.waitingProgress === slot) this.waitingProgress = null;
      return this.commitProgress(slot.runId, slot.ackedLines);
    });
  }

  private async commitProgress(runId: RunId, ackedLines: number): Promise<void> {
    const updated = await this.repository.updateProgress(runId, ackedLines, this.nowIso());
    if (updated.ok && updated.value) {
      if (this.watermarkRunId === runId) {
        this.lastPersistedAck = Math.max(this.lastPersistedAck, ackedLines);
      }
      return;
    }
    if (updated.ok && progressDeferredOrSettled(this.repository, runId, ackedLines)) return;
    if (updated.ok) this.untrackedRunId = runId;
    this.reportQueueFailure(updated);
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch(this.reportQueueFailure);
  }

  private beginRun(runId: RunId): void {
    if (this.pendingMissingTerminal?.runId !== runId) this.pendingMissingTerminal = null;
    if (this.deferredArchiveHandoff?.runId !== runId) this.deferredArchiveHandoff = null;
    this.previous = null;
    this.watermarkRunId = runId;
    this.lastPersistedAck = cachedAck(this.repository, runId);
    this.highestQueuedAck = this.lastPersistedAck;
    this.terminalQueued = false;
  }

  private clearRunWatermarks(): void {
    this.previous = null;
    this.watermarkRunId = null;
    this.lastPersistedAck = 0;
    this.highestQueuedAck = 0;
    this.terminalQueued = false;
  }

  private queueMissingTerminalSettlement(): void {
    const pending = this.pendingMissingTerminal;
    if (pending === null || this.queuedMissingTerminal === pending) return;
    this.queuedMissingTerminal = pending;
    this.waitingProgress = null;
    this.enqueue(async () => {
      let retryAfterActivation = false;
      try {
        if (!this.ownsPendingTerminal(pending)) return;
        const before = this.repository.getSnapshot();
        const settled =
          pending.kind === 'completed'
            ? await this.repository.completeRun(pending.runId, pending.settledAtIso)
            : await this.repository.interruptRun(
                pending.runId,
                pending.ackedLines,
                pending.interruption,
                pending.settledAtIso,
              );
        if (!settled.ok || !settled.value) {
          const handoff = this.archiveHandoffOrRetire(before, pending.runId);
          if (this.deferMissingTerminal(pending, handoff)) {
            retryAfterActivation = this.repository.getSnapshot().activeRun?.runId === pending.runId;
            if (!settled.ok) this.reportQueueFailure(settled);
            return;
          }
          this.reportQueueFailure(settled);
          return;
        }
        this.clearDeferredArchiveHandoff(pending.runId);
        clearInactiveRunOwnership(pending.runId);
        if (this.pendingMissingTerminal === pending) {
          this.pendingMissingTerminal = null;
          // A later live run can supersede this terminal while persistence is
          // awaiting. Only the still-owned completion may offer a second pass.
          // Deferred archive activation can succeed before its receipt exists;
          // the UI waits for the matching verified receipt before displaying it.
          if (pending.kind === 'completed') this.onCompleted(pending.runId);
        }
      } finally {
        if (this.queuedMissingTerminal === pending) this.queuedMissingTerminal = null;
        // Activation can land while this no-op's response is still awaited,
        // making its ordinary Start cleanup update miss the queued terminal.
        // Retry once from the now-active slot; another no-op is a real failure.
        if (retryAfterActivation) this.retryOwnedMissingTerminal(pending);
      }
    });
  }

  private retryOwnedMissingTerminal(pending: PendingMissingTerminal): void {
    if (this.pendingMissingTerminal === pending) this.queueMissingTerminalSettlement();
  }

  private ownsPendingTerminal(pending: PendingMissingTerminal): boolean {
    return this.pendingMissingTerminal === pending && this.terminalStillOwned(pending.runId);
  }

  private deferMissingTerminal(
    pending: PendingMissingTerminal,
    handoff: CheckpointArchiveHandoff | null,
  ): boolean {
    if (this.pendingMissingTerminal !== pending || handoff === null) return false;
    this.deferredArchiveHandoff = handoff;
    return true;
  }
}

function progressDeferredOrSettled(
  repository: RecoveryRepository,
  runId: RunId,
  ackedLines: number,
): boolean {
  const snapshot = repository.getSnapshot();
  if (snapshot.activeRun?.runId === runId) return false;
  if (snapshot.pendingStart?.runId === runId) return true;
  if (snapshot.lastCompletedReceipt?.runId === runId) return true;
  return (
    snapshot.recoveryCapsule?.runId === runId && snapshot.recoveryCapsule.ackedLines >= ackedLines
  );
}

function activeInRepository(repository: RecoveryRepository, runId: RunId): boolean {
  return repository.getSnapshot().activeRun?.runId === runId;
}

function onceTrackingFailureReporter(
  reportTrackingFailure: TrackingFailureReporter,
): TrackingFailureReporter {
  let hasReported = false;
  return (error) => {
    if (hasReported) return;
    hasReported = true;
    reportTrackingFailure(error);
  };
}

function cachedAck(repository: RecoveryRepository, runId: RunId): number {
  const active = repository.getSnapshot().activeRun;
  return active?.runId === runId ? active.ackedLines : 0;
}

function disappearedStreamInterruption(
  previousStatus: StreamerStatus,
  state: LaserState,
): JobInterruption {
  return (
    checkpointInterruption(
      previousStatus,
      state.safetyNotice,
      currentJobStopRequest(state),
      currentRunPlannerBacklog(state),
    ) ?? {
      kind: state.connection.kind === 'connected' ? 'unknown' : 'disconnect',
      message:
        state.connection.kind === 'connected'
          ? 'The job stream ended before clean physical completion.'
          : 'The controller connection ended before clean physical completion.',
    }
  );
}

function clearInactiveRunOwnership(runId: RunId): void {
  const state = useLaserStore.getState();
  if (state.streamer === null && state.activeRunId === runId) {
    useLaserStore.setState({ activeRunId: null });
  }
}

async function initialize(repository: RecoveryRepository): Promise<void> {
  await repository.initialize();
}

export function useJobCheckpoint(): void {
  useEffect(() => installJobCheckpointTracking(), []);
}
