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
