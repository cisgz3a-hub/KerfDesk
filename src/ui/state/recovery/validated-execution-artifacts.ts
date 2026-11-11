// Identity memo of execution artifacts that passed full validation
// (ADR-337 Amendment 2).
//
// Hydrated artifacts are immutable, and the snapshot coordinator hands the
// same references back on every refresh. Full validation fingerprints the
// whole program text, walks the packed manifest and recounts sendable lines,
// so it runs once per artifact identity instead of two or three times per
// retained run on every refresh.
//
// The store's stage step validates a running job's archive through the
// archive's sliced runner and notes it here. The refresh that activates the
// run right after the first line then receives that same identity, so it
// does not repeat the whole-program pass in one task while the job runs. An
// artifact read back from storage is a new identity and is validated in full.

import { isExecutionArtifact, type ExecutionArtifactV1 } from './execution-artifact';

const validatedExecutionArtifacts = new WeakSet<object>();

/** Record an artifact that already passed `isExecutionArtifact` (or its
 * stepped form, drained in full). Only the trust boundary that ran that
 * check may call this. */
export function noteValidatedExecutionArtifact(artifact: ExecutionArtifactV1): void {
  validatedExecutionArtifacts.add(artifact);
}

export function isValidatedExecutionArtifact(value: unknown): value is ExecutionArtifactV1 {
  if (typeof value === 'object' && value !== null && validatedExecutionArtifacts.has(value)) {
    return true;
  }
  if (!isExecutionArtifact(value)) return false;
  validatedExecutionArtifacts.add(value);
  return true;
}
