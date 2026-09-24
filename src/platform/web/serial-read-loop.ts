// The main-thread transport's read loop (web-serial.ts): reads the port, frames
// lines, hands them to subscribers in bounded slices (ADR-356), and survives the
// Web Serial line errors that leave the port open (audit connect-1).

import { createReadSlice, type ReadSlice } from './serial-read-slice';
import {
  createReadRecoveryBudget,
  recoverableReadErrorName,
  type ReadRecoveryBudget,
} from './serial-read-recovery';
import { EMPTY_SERIAL_LINE_STATE, extractSerialLines } from './serial-wire';

type LineSubscribers = ReadonlySet<(line: string) => void>;

/** What the loop reads, shared with the connection's teardown. */
export type SerialReadTarget = {
  readonly port: { readonly readable: ReadableStream<Uint8Array> | null };
  /** The reader teardown cancels. The loop swaps in a fresh one after a
   *  recovered line error, so Close always cancels the live reader; a stale
   *  one would leave the new stream locked and port.close() would fail. */
  reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  /** False once the connection is closing: no new reader, no more lines. */
  readonly isOpen: () => boolean;
};

type ReadFailure = { readonly error: unknown };

/** Reads until the stream ends or fails for good, then runs `onEnd` once. */
export async function runSerialReadLoop(
  target: SerialReadTarget,
  lineSubs: LineSubscribers,
  onEnd: () => void,
): Promise<void> {
  let reader = target.reader;
  if (reader === undefined) return;
  const slice = createReadSlice();
  const budget = createReadRecoveryBudget();
  try {
    while (reader !== undefined) {
      const failure = await readUntilEnd(reader, lineSubs, slice, target.isOpen, budget);
      if (failure === null) return;
      if (!replaceFailedReader(target, reader, failure.error, budget)) {
        console.error('Serial read loop terminated:', failure.error);
        return;
      }
      reader = target.reader;
    }
  } finally {
    slice.close();
    onEnd();
  }
}

// Resolves null when the stream ended (a cancel, or the connection closing
// while lines were still being dispatched), or the error that ended it.
async function readUntilEnd(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  lineSubs: LineSubscribers,
  slice: ReadSlice,
  isOpen: () => boolean,
  budget: ReadRecoveryBudget,
): Promise<ReadFailure | null> {
  // Framing lives and dies with one reader. A line error means bytes are
  // missing at the point of failure, so the partial record before it is
  // dropped rather than glued onto the next stream's bytes, where a lost digit
  // could turn into a plausible but wrong position.
  const decoder = new TextDecoder('utf-8');
  let framing = EMPTY_SERIAL_LINE_STATE;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return null;
      if (value.byteLength > 0) budget.received();
      slice.resumed();
      const extracted = extractSerialLines(framing, decoder.decode(value, { stream: true }));
      framing = extracted.state;
      const dispatched = dispatchLines(lineSubs, extracted.lines, slice, isOpen, 0);
      if (dispatched !== true && !(await dispatched)) return null;
    }
  } catch (error) {
    return { error };
  }
}

// After a recoverable line error the port is still open and `port.readable` is
// already a fresh stream (Web Serial spec). Reading on keeps the session, and
// the writer, alive. Returns false when the error must end the session.
function replaceFailedReader(
  target: SerialReadTarget,
  failed: ReadableStreamDefaultReader<Uint8Array>,
  error: unknown,
  budget: ReadRecoveryBudget,
): boolean {
  const name = recoverableReadErrorName(error);
  if (name === null || !target.isOpen() || !budget.admit()) return false;
  releaseReaderLock(failed);
  // Synchronous from the open check to the assignment, so a Close that starts
  // meanwhile either sees the new reader or stops the loop before it exists.
  const readable = target.port.readable;
  target.reader = undefined;
  if (readable === null || readable.locked) return false;
  target.reader = readable.getReader();
  console.warn(`Serial line error (${name}); the port is still open, so reading continues.`);
  return true;
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch {
    // Already released.
  }
}

// Dispatches in wire order, synchronously while the task's slice lasts (so an
// ordinary chunk behaves exactly as before), then continues on a later task
// (ADR-356). A connection closed during that yield gets no further lines: they
// are dropped exactly as bytes still in flight at close are.
function dispatchLines(
  lineSubs: LineSubscribers,
  lines: ReadonlyArray<string>,
  slice: ReadSlice,
  isOpen: () => boolean,
  from: number,
): true | Promise<boolean> {
  for (let index = from; index < lines.length; index += 1) {
    if (slice.spent()) return dispatchAfterYield(lineSubs, lines, slice, isOpen, index);
    dispatchLine(lineSubs, lines[index] ?? '');
  }
  return true;
}

async function dispatchAfterYield(
  lineSubs: LineSubscribers,
  lines: ReadonlyArray<string>,
  slice: ReadSlice,
  isOpen: () => boolean,
  from: number,
): Promise<boolean> {
  await slice.yieldTask();
  if (!isOpen()) return false;
  return await dispatchLines(lineSubs, lines, slice, isOpen, from);
}

// Subscriber exceptions must not masquerade as a dropped cable: before this
// isolation, one throwing handler exited the read loop through catch/finally,
// closed the streams, and fired onClose — a full mid-job "port closed" — and
// silently dropped the rest of the chunk's lines. Loop-fatal behavior is
// reserved for genuine stream errors from reader.read().
function dispatchLine(lineSubs: LineSubscribers, line: string): void {
  for (const h of lineSubs) {
    try {
      h(line);
    } catch (err) {
      console.error('Serial line handler threw; continuing with remaining lines:', err);
    }
  }
}
