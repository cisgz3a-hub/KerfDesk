// Multi-File Trace traces on its own trace client (createTraceWorkerClient), so
// a Trace Image preview or commit no longer supersedes it (ADR-431 Amendment
// 2026-11-14). A superseded rejection can still reach the batch from an
// injected tracer or a worker that answers late, so it is retried, and a file
// that keeps being interrupted becomes that file's skip. Only the batch's own
// Cancel stops it.

import { isTraceRequestSuperseded } from '../trace/use-trace-worker-client';

/** Retries after the first superseded attempt before the file is skipped. */
export const SUPERSEDED_TRACE_RETRIES = 2;

export const INTERRUPTED_TRACE_MESSAGE =
  'Another trace (such as a Trace Image preview) kept interrupting this file.';

/** A file whose trace kept being superseded: it is skipped, never traced at a
 * coarser grid instead (ADR-431 Amendment 2026-09-27, item 1). */
export class TraceInterruptedError extends Error {
  override readonly name = 'TraceInterruptedError';

  constructor() {
    super(INTERRUPTED_TRACE_MESSAGE);
  }
}

export function isTraceInterrupted(error: unknown): boolean {
  return error instanceof TraceInterruptedError;
}

type TraceCall<Image, Options, Result> = (
  image: Image,
  options: Options,
  signal?: AbortSignal,
) => Promise<Result>;

/** Wraps a batch trace so a request superseded by another caller is retried. */
export function retrySupersededTrace<Image, Options, Result>(
  trace: TraceCall<Image, Options, Result>,
  batchSignal: AbortSignal | undefined,
): TraceCall<Image, Options, Result> {
  return async (image, options, signal) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Keep the call's arity: a trace that never got a signal gets none.
        return await (signal === undefined ? trace(image, options) : trace(image, options, signal));
      } catch (error) {
        // After the batch's own Cancel, the superseded rejection IS the cancel.
        if (!isTraceRequestSuperseded(error) || batchSignal?.aborted === true) throw error;
        if (attempt >= SUPERSEDED_TRACE_RETRIES) throw new TraceInterruptedError();
      }
    }
  };
}
