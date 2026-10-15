// Drain queued cleanup bytes first. A timed-out abort is only a request, not
// proof that the sink or its native port has stopped. Callers retain ownership
// until writer.closed settles, or a worker owner terminates the worker.
const WRITER_CLOSE_TIMEOUT_MS = 1_500;

type CloseOutcome = 'closed' | 'failed' | 'aborted' | 'timed-out';

/** Bounds both drain and abort; never rejects, including late failures. */
export async function closeWriterBounded(
  writer: Pick<WritableStreamDefaultWriter<Uint8Array>, 'close' | 'abort'>,
  timeoutMs: number = WRITER_CLOSE_TIMEOUT_MS,
): Promise<CloseOutcome> {
  let drained = false;
  let closed: Promise<CloseOutcome>;
  try {
    closed = Promise.resolve(writer.close()).then(
      () => {
        drained = true;
        return 'closed';
      },
      () => 'failed',
    );
  } catch {
    return 'failed';
  }
  const outcome = await within(closed, timeoutMs);
  if (outcome !== 'timed-out') return outcome;
  try {
    const aborted = await within(
      Promise.resolve(writer.abort()).then(
        () => 'aborted' as const,
        () => 'failed' as const,
      ),
      timeoutMs,
    );
    // WHATWG abort waits for an in-flight close. If that drain eventually
    // succeeds, it closes normally and never invokes the sink's abort.
    return drained ? 'closed' : aborted;
  } catch {
    return 'failed';
  }
}

async function within(operation: Promise<CloseOutcome>, timeoutMs: number): Promise<CloseOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<'timed-out'>((resolve) => {
        timer = setTimeout(() => resolve('timed-out'), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export { WRITER_CLOSE_TIMEOUT_MS };
