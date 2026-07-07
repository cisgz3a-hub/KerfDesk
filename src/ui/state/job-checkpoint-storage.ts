// localStorage slot for the interrupted-job checkpoint (ADR-118). Mirrors
// autosave.ts: a single keyed record, strict-parsed on read, corrupt payloads
// discarded. Writes are best-effort — a checkpoint must never be a reason a
// job fails to run, so quota/private-mode failures are swallowed.

import {
  parseJobCheckpoint,
  serializeJobCheckpoint,
  type JobCheckpoint,
} from '../../core/recovery';

export const JOB_CHECKPOINT_STORAGE_KEY = 'laserforge.job-checkpoint.v1';

// Streaming writes are throttled to once per this many acked lines; status
// transitions (pause / cancel / error / disconnect) always write immediately.
// At a worst-case ~200 acks/s this is ≤ 8 tiny synchronous writes per second.
export const CHECKPOINT_ACK_INTERVAL_LINES = 25;

export function readJobCheckpoint(): JobCheckpoint | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(JOB_CHECKPOINT_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  const checkpoint = parseJobCheckpoint(raw);
  // A corrupt slot can only nag forever — discard it once.
  if (checkpoint === null) clearJobCheckpoint();
  return checkpoint;
}

export function writeJobCheckpoint(checkpoint: JobCheckpoint): void {
  try {
    localStorage.setItem(JOB_CHECKPOINT_STORAGE_KEY, serializeJobCheckpoint(checkpoint));
  } catch {
    // Best-effort: quota exhaustion or private mode must not surface here.
  }
}

export function clearJobCheckpoint(): void {
  try {
    localStorage.removeItem(JOB_CHECKPOINT_STORAGE_KEY);
  } catch {
    // Same best-effort contract as writes.
  }
}
