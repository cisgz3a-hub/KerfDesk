// Multi-File Trace shares the one trace worker with the Trace Image dialog,
// whose live preview supersedes every pending trace when it starts one. While
// the editor stays usable during a batch, a preview must not end the batch:
// a trace superseded by someone else is retried, and a file that keeps being
// interrupted becomes that file's skip. Only the batch's own Cancel stops it.

import { isTraceRequestSuperseded } from '../trace/use-trace-worker-client';

/** Retries after the first superseded attempt before the file is skipped. */
export const SUPERSEDED_TRACE_RETRIES = 2;

export const INTERRUPTED_TRACE_MESSAGE =
  'Another trace (such as a Trace Image preview) kept interrupting this file.';

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
        if (attempt >= SUPERSEDED_TRACE_RETRIES) throw new Error(INTERRUPTED_TRACE_MESSAGE);
      }
    }
  };
}
