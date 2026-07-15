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
import { checkpointInterruption } from './checkpoint-interruption';

type StreamObservation = {
  readonly runId: RunId;
  readonly status: StreamerStatus;
  readonly completed: number;
};

export function installJobCheckpointTracking(
  nowIso: () => string = () => new Date().toISOString(),
  repository: RecoveryRepository = recoveryRepository,
): () => void {
  let previous: StreamObservation | null = null;
  let lastQueuedAck = 0;
  let terminalQueued = false;
  let queue: Promise<void> = initialize(repository);

  const enqueue = (work: () => Promise<void>): void => {
    queue = queue.then(work).catch(() => undefined);
  };

  const observeMissingStreamer = (state: LaserState, priorState: LaserState | undefined): void => {
    if (previous !== null) {
      const ended = previous;
      const work = settledCleanly(state, priorState, ended.status)
        ? () => completeAndClear(repository, ended, nowIso)
        : () => interruptAndClear(repository, ended, state, nowIso);
      enqueue(work);
    }
    previous = null;
    lastQueuedAck = 0;
    terminalQueued = false;
  };

  const observeStreamer = (state: LaserState, streamer: StreamerState): void => {
    const runId = state.activeRunId;
    if (runId === null) {
      previous = null;
      return;
    }
    if (previous?.runId !== runId) {
      previous = null;
      lastQueuedAck = cachedAck(repository, runId);
      terminalQueued = false;
    }
    const statusChanged = streamer.status !== previous?.status;
    const interruption = statusChanged
      ? checkpointInterruption(streamer.status, state.safetyNotice)
      : null;
    const observation = { runId, status: streamer.status, completed: streamer.completed };
    previous = observation;

    if (interruption !== null && !terminalQueued) {
      terminalQueued = true;
      lastQueuedAck = Math.max(lastQueuedAck, streamer.completed);
      enqueue(async () => {
        await repository.interruptRun(runId, streamer.completed, interruption, nowIso());
      });
      return;
    }

    const due = streamer.completed - lastQueuedAck >= CHECKPOINT_ACK_INTERVAL_LINES;
    if (!due && !statusChanged) return;
    lastQueuedAck = Math.max(lastQueuedAck, streamer.completed);
    enqueue(async () => {
      await repository.updateProgress(runId, streamer.completed, nowIso());
    });
  };

  const sync = (state: LaserState, priorState?: LaserState): void => {
    if (state.streamer === null) observeMissingStreamer(state, priorState);
    else observeStreamer(state, state.streamer);
  };

  sync(useLaserStore.getState());
  return useLaserStore.subscribe(sync);
}

function cachedAck(repository: RecoveryRepository, runId: RunId): number {
  const active = repository.getSnapshot().activeRun;
  return active?.runId === runId ? active.ackedLines : 0;
}

async function completeAndClear(
  repository: RecoveryRepository,
  ended: StreamObservation,
  nowIso: () => string,
): Promise<void> {
  await repository.completeRun(ended.runId, nowIso());
  clearInactiveRunOwnership(ended.runId);
}

async function interruptAndClear(
  repository: RecoveryRepository,
  ended: StreamObservation,
  state: LaserState,
  nowIso: () => string,
): Promise<void> {
  await repository.interruptRun(
    ended.runId,
    ended.completed,
    disappearedStreamInterruption(ended.status, state),
    nowIso(),
  );
  clearInactiveRunOwnership(ended.runId);
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
