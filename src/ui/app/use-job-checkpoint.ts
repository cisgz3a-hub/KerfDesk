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
import { useToastStore } from '../state/toast-store';
import { checkpointInterruption } from './checkpoint-interruption';

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

const TRACKING_FAILURE_MESSAGE =
  'Job recovery tracking hit an unexpected error. The current job is unaffected, and progress will remain eligible for retry.';

export function installJobCheckpointTracking(
  nowIso: () => string = () => new Date().toISOString(),
  repository: RecoveryRepository = recoveryRepository,
  reportTrackingFailure: TrackingFailureReporter = defaultTrackingFailureReporter,
): () => void {
  const tracker = new JobCheckpointTracker(nowIso, repository, reportTrackingFailure);
  tracker.sync(useLaserStore.getState());
  return useLaserStore.subscribe(tracker.sync);
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
  private queue: Promise<void>;
  private readonly reportQueueFailure: TrackingFailureReporter;

  constructor(
    private readonly nowIso: () => string,
    private readonly repository: RecoveryRepository,
    reportTrackingFailure: TrackingFailureReporter,
  ) {
    this.reportQueueFailure = onceTrackingFailureReporter(reportTrackingFailure);
    this.queue = initialize(repository).catch(this.reportQueueFailure);
  }

  readonly sync = (state: LaserState, priorState?: LaserState): void => {
    if (state.streamer === null) this.observeMissingStreamer(state, priorState);
    else this.observeStreamer(state, state.streamer);
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
    if (runId === null) {
      this.clearRunWatermarks();
      return;
    }
    if (this.previous?.runId !== runId) this.beginRun(runId);
    const statusChanged = streamer.status !== this.previous?.status;
    const interruption = checkpointInterruption(streamer.status, state.safetyNotice);
    this.previous = { runId, status: streamer.status, completed: streamer.completed };

    if (interruption !== null && !this.terminalQueued) {
      this.queueInterruption(runId, streamer.completed, interruption);
      return;
    }

    const pendingBaseline = Math.max(this.lastPersistedAck, this.highestQueuedAck);
    const due = streamer.completed - pendingBaseline >= CHECKPOINT_ACK_INTERVAL_LINES;
    const statusProgressDue = statusChanged && streamer.completed > this.highestQueuedAck;
    if (due || statusProgressDue) this.queueProgress(runId, streamer.completed);
  }

  private queueInterruption(runId: RunId, ackedLines: number, interruption: JobInterruption): void {
    this.terminalQueued = true;
    this.enqueue(async () => {
      try {
        const interrupted = await this.repository.interruptRun(
          runId,
          ackedLines,
          interruption,
          this.nowIso(),
        );
        if (interrupted.ok && interrupted.value) return;
        if (this.watermarkRunId === runId) this.terminalQueued = false;
        this.reportQueueFailure(interrupted);
      } catch (error) {
        if (this.watermarkRunId === runId) this.terminalQueued = false;
        throw error;
      }
    });
  }

  private queueProgress(runId: RunId, queuedAck: number): void {
    this.highestQueuedAck = Math.max(this.highestQueuedAck, queuedAck);
    this.enqueue(async () => {
      try {
        const updated = await this.repository.updateProgress(runId, queuedAck, this.nowIso());
        if (!updated.ok || !updated.value) {
          this.reportQueueFailure(updated);
          return;
        }
        if (this.watermarkRunId === runId) {
          this.lastPersistedAck = Math.max(this.lastPersistedAck, queuedAck);
        }
      } finally {
        if (this.watermarkRunId === runId && queuedAck >= this.highestQueuedAck) {
          this.highestQueuedAck = this.lastPersistedAck;
        }
      }
    });
  }

  private enqueue(work: () => Promise<void>): void {
    this.queue = this.queue.then(work).catch(this.reportQueueFailure);
  }

  private beginRun(runId: RunId): void {
    if (this.pendingMissingTerminal?.runId !== runId) this.pendingMissingTerminal = null;
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
    this.enqueue(async () => {
      try {
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
          this.reportQueueFailure(settled);
          return;
        }
        clearInactiveRunOwnership(pending.runId);
        if (this.pendingMissingTerminal === pending) this.pendingMissingTerminal = null;
      } finally {
        if (this.queuedMissingTerminal === pending) this.queuedMissingTerminal = null;
      }
    });
  }
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

function settledCleanly(
  state: LaserState,
  priorState: LaserState | undefined,
  previousStatus: StreamerStatus,
): boolean {
  return (
    previousStatus === 'done' &&
    priorState?.streamer?.status === 'done' &&
    priorState.controllerOperation?.kind === 'post-job-settle' &&
    priorState.controllerOperation.phase === 'awaiting-idle' &&
    state.connection.kind === 'connected' &&
    state.statusReport?.state === 'Idle'
  );
}

function disappearedStreamInterruption(
  previousStatus: StreamerStatus,
  state: LaserState,
): JobInterruption {
  return (
    checkpointInterruption(previousStatus, state.safetyNotice) ?? {
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
