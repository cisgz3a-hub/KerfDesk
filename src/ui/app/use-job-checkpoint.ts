// useJobCheckpoint (ADR-118) — keeps the interrupted-job checkpoint current
// while a job streams. runStartJobFlow writes the initial record; this hook
// advances ackedLines from streamer.completed (every
// CHECKPOINT_ACK_INTERVAL_LINES while streaming, immediately on any status
// transition) and clears the slot only after 'done' is followed by connected,
// physical Idle. A checkpoint survives Stop, error, disconnect, and crash.
//
// A resume run (preamble + tail, its own line numbering) is NOT tracked (v1,
// ADR-118): the flow stamps `resumeInFlight` before launching it, and this
// hook also requires the streamer total to equal the checkpoint's sendable
// count — belt and braces so foreign ack counts can never corrupt the
// original record. The original checkpoint stays put — stale toward earlier
// lines, which re-burns a short stretch rather than leaving a gap. A resume
// run's settled Idle still clears the slot: the job is physically complete.
//
// The checkpoint is ~200 bytes; re-reading it per store fire costs
// microseconds and leaves no cache to go stale against the flow's writes.

import { useEffect } from 'react';
import type { StreamerStatus } from '../../core/controllers/grbl';
import { advanceJobCheckpoint, withJobInterruption } from '../../core/recovery';
import {
  CHECKPOINT_ACK_INTERVAL_LINES,
  clearJobCheckpoint,
  readJobCheckpoint,
  writeJobCheckpoint,
} from '../state/job-checkpoint-storage';
import { useLaserStore, type LaserState } from '../state/laser-store';
import { checkpointInterruption } from './checkpoint-interruption';

export function installJobCheckpointTracking(
  nowIso: () => string = () => new Date().toISOString(),
): () => void {
  let lastStatus: StreamerStatus | null = null;
  const sync = (state: LaserState): void => {
    const streamer = state.streamer;
    if (streamer === null) {
      clearSettledCheckpoint(state, lastStatus);
      lastStatus = null;
      return;
    }
    const statusChanged = streamer.status !== lastStatus;
    lastStatus = streamer.status;
    const checkpoint = readJobCheckpoint();
    if (checkpoint === null) return;
    if (checkpoint.resumeInFlight) return; // resume run streaming — frozen
    if (streamer.total !== checkpoint.sendableLines) return; // foreign run — frozen
    const due = streamer.completed - checkpoint.ackedLines >= CHECKPOINT_ACK_INTERVAL_LINES;
    if (!due && !statusChanged) return;
    const now = nowIso();
    const advanced = advanceJobCheckpoint(checkpoint, streamer.completed, now);
    const interruption = statusChanged
      ? checkpointInterruption(streamer.status, state.safetyNotice)
      : null;
    writeJobCheckpoint(
      interruption === null ? advanced : withJobInterruption(advanced, interruption, now),
    );
  };
  sync(useLaserStore.getState());
  return useLaserStore.subscribe(sync);
}

function clearSettledCheckpoint(state: LaserState, lastStatus: StreamerStatus | null): void {
  if (
    lastStatus === 'done' &&
    state.connection.kind === 'connected' &&
    state.statusReport?.state === 'Idle'
  ) {
    clearJobCheckpoint();
  }
}

export function useJobCheckpoint(): void {
  useEffect(() => installJobCheckpointTracking(), []);
}
