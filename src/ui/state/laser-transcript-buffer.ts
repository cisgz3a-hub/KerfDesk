// laser-transcript-buffer — holds the job stream's acknowledgement flood out
// of the React-observable store until a line arrives that someone is waiting
// to see (ADR-333).
//
// A dense raster acknowledges 400-1500 lines a second. Recording each one
// straight into `log` and `transcript` cost a `set()` per line, and every
// `set()` copies the whole hundred-key laser state and notifies every
// subscriber — measured at about a third of the per-acknowledgement host work,
// and the reason the console reconciled its row list hundreds of times a
// second for output its own filter hides by default.
//
// So a stream-owned `ok` is appended to a plain array on the refs instead. The
// next non-job line publishes the batch immediately. Job-only traffic also
// publishes on the first entry at least 250 ms after the batch began: Marlin
// cannot poll status while streaming. Fixed-size rings retain the newest
// history even if no such flush arrives.
//
// The buffer is diagnostic history, not machine state: nothing in the ack
// ledger, the streamer or the safety notices reads it, and every teardown that
// resets the transcript clears it.

import type { LaserState } from './laser-store';
import { TRANSCRIPT_MAX, type SerialTranscriptEntry } from './laser-transcript';
import { LOG_MAX } from './laser-store-helpers';

export type TranscriptBufferRefs = {
  /** Bounded rings; publication restores oldest-first order. */
  bufferedTranscript?: SerialTranscriptEntry[];
  bufferedLog?: string[];
  bufferedTranscriptStart?: number;
  bufferedLogStart?: number;
  bufferedTranscriptAt?: number | null;
};

export const TRANSCRIPT_BATCH_MS = 250;

type TranscriptPatch = Pick<LaserState, 'log' | 'transcript'>;

/** Hold one entry back from the store. `logLine` is omitted for records that
 * never appear in the operator log (outbound job chunks). Returns true when
 * this arrival should publish the batch, independent of controller polling. */
export function bufferTranscriptEntry(
  refs: TranscriptBufferRefs,
  entry: SerialTranscriptEntry,
  logLine?: string,
): boolean {
  refs.bufferedTranscriptAt ??= entry.at;
  refs.bufferedTranscriptStart = pushRing(
    (refs.bufferedTranscript ??= []),
    refs.bufferedTranscriptStart ?? 0,
    entry,
    TRANSCRIPT_MAX,
  );
  if (logLine !== undefined) {
    refs.bufferedLogStart = pushRing(
      (refs.bufferedLog ??= []),
      refs.bufferedLogStart ?? 0,
      logLine,
      LOG_MAX,
    );
  }
  const age = entry.at - refs.bufferedTranscriptAt;
  return age >= TRANSCRIPT_BATCH_MS || age < 0;
}

export function hasBufferedTranscript(refs: TranscriptBufferRefs): boolean {
  return (refs.bufferedTranscript?.length ?? 0) > 0 || (refs.bufferedLog?.length ?? 0) > 0;
}

/**
 * The patch that publishes everything buffered plus `entry` (and `logLine`)
 * last. Call it for any line the flood-buffer does not own; the result is a
 * single `set()` payload however many acknowledgements it carries.
 */
export function publishTranscriptPatch(
  refs: TranscriptBufferRefs,
  state: Pick<LaserState, 'log' | 'transcript'>,
  entry?: SerialTranscriptEntry,
  logLine?: string,
): TranscriptPatch {
  const entries = orderedRing(refs.bufferedTranscript ?? [], refs.bufferedTranscriptStart ?? 0);
  const logLines = orderedRing(refs.bufferedLog ?? [], refs.bufferedLogStart ?? 0);
  const patch: TranscriptPatch = {
    transcript: appendBounded(state.transcript, entries, entry, TRANSCRIPT_MAX),
    log: appendBounded(state.log, logLines, logLine, LOG_MAX),
  };
  clearTranscriptBuffer(refs);
  return patch;
}

/** Drop what was held back. Used by every path that resets the transcript —
 * connect, disconnect, port close, a reboot banner, an operator Clear — where
 * publishing the old session's lines into the new one would be wrong. */
export function clearTranscriptBuffer(refs: TranscriptBufferRefs): void {
  refs.bufferedTranscript = [];
  refs.bufferedLog = [];
  refs.bufferedTranscriptStart = 0;
  refs.bufferedLogStart = 0;
  refs.bufferedTranscriptAt = null;
}

function pushRing<T>(items: T[], start: number, item: T, max: number): number {
  if (items.length < max) {
    items.push(item);
    return start;
  }
  items[start] = item;
  return (start + 1) % max;
}

function orderedRing<T>(items: T[], start: number): ReadonlyArray<T> {
  return start === 0 ? items : [...items.slice(start), ...items.slice(0, start)];
}

function appendBounded<T>(
  current: ReadonlyArray<T>,
  buffered: ReadonlyArray<T>,
  last: T | undefined,
  max: number,
): ReadonlyArray<T> {
  if (buffered.length === 0 && last === undefined) return current;
  const next = last === undefined ? [...current, ...buffered] : [...current, ...buffered, last];
  return next.length > max ? next.slice(-max) : next;
}
