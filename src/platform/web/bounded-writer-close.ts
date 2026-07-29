// Bounded close for a serial writable stream.
//
// WritableStreamDefaultWriter.close() settles only after the underlying sink
// has processed every previously-written chunk. A sink that cannot drain — a
// wedged USB-serial bridge, asserted hardware flow control, and a fortiori a
// half-open socket — never settles it, and nothing above this point carries a
// deadline: the disconnect chain awaits connection.close() unconditionally, so
// Disconnect spins forever and the connection reference is never released,
// which also stops Connect from replacing the port.
//
// Why abort() is the fallback and not the first move: abort() DISCARDS queued
// bytes (Chromium implements it as a transmit-buffer flush), and this runs
// after the disconnect transaction has already written the driver's laser-off
// lines. Aborting first could drop those bytes. Aborting only after the
// deadline cannot: a sink that has not drained within the deadline was not
// delivering them anyway, and hanging forever does not deliver them either —
// it only wedges the app on top of the same undelivered write.

const WRITER_CLOSE_TIMEOUT_MS = 1_500;

type CloseOutcome = 'closed' | 'failed' | 'aborted';

/**
 * Close a writer, falling back to abort() once the drain deadline passes.
 *
 * Never rejects: teardown callers have no useful recovery, and a throw here
 * would strand the port. `now`-free by design — the timer is the deadline.
 */
export async function closeWriterBounded(
  writer: Pick<WritableStreamDefaultWriter<Uint8Array>, 'close' | 'abort'>,
  timeoutMs: number = WRITER_CLOSE_TIMEOUT_MS,
): Promise<CloseOutcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs);
  });
  // Settle the close attempt into a value either way, so a late rejection
  // after the deadline wins cannot surface as an unhandled rejection.
  // Promise.resolve + try tolerate a close() that throws synchronously or
  // returns a non-promise, keeping the never-rejects contract literally true.
  let closed: Promise<CloseOutcome>;
  try {
    closed = Promise.resolve(writer.close()).then(
      () => 'closed',
      () => 'failed',
    );
  } catch {
    if (timer !== undefined) clearTimeout(timer);
    return 'failed';
  }
  try {
    const outcome = await Promise.race([closed, deadline]);
    if (outcome !== 'timeout') return outcome;
    try {
      await writer.abort();
    } catch {
      // The stream was already errored or locked away; nothing further to do.
    }
    return 'aborted';
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export { WRITER_CLOSE_TIMEOUT_MS };
