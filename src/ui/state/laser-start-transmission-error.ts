/** A program write was attempted. A rejected transport promise cannot prove
 * that the controller received no bytes, even after onClose clears live state.
 * Callers must retain this run's recovery ownership instead of reviving an
 * older checkpoint. Acknowledgements are transport progress, never burn proof. */
export class JobStartTransmissionError extends Error {
  readonly runId: string | null;
  readonly ackedLines: number;

  constructor(cause: unknown, runId: string | null, ackedLines: number) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'JobStartTransmissionError';
    this.runId = runId;
    this.ackedLines = ackedLines;
  }
}

export function isJobStartTransmissionError(error: unknown): error is JobStartTransmissionError {
  return error instanceof JobStartTransmissionError;
}

/** Controller preparation was attempted, but no program window was handed to
 * the transport. Reset/control bytes may have reached the controller, so its
 * quarantine still applies; they cannot replace the saved program's ownership. */
export class JobStartBeforeProgramError extends Error {
  readonly runId: string | null;

  constructor(cause: unknown, runId: string | null) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'JobStartBeforeProgramError';
    this.runId = runId;
  }
}

export function isJobStartBeforeProgramError(error: unknown): error is JobStartBeforeProgramError {
  return error instanceof JobStartBeforeProgramError;
}

/** Stream state is installed before the separate override reset. It is not
 * evidence that a program write was attempted: record that exact invocation. */
export function createJobStartWriteAttempt(runId: string | null) {
  let programAttempted = false;
  return {
    markProgramAttempted: (): void => {
      programAttempted = true;
    },
    assertProgramAttempted: (): void => {
      if (!programAttempted) {
        throw new JobStartBeforeProgramError(
          'Start was cancelled before any job program was written.',
          runId,
        );
      }
    },
    failure: (cause: unknown, ackedLines: number): Error =>
      programAttempted
        ? new JobStartTransmissionError(cause, runId, ackedLines)
        : new JobStartBeforeProgramError(cause, runId),
  };
}
