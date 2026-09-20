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
// next line that is NOT part of that flood — a status report (four a second
// while connected), an error, a banner, any console or motion reply — carries
// the buffered entries into the store ahead of itself, in wire order. The
// transcript therefore stays complete and correctly ordered; it is only
// published in batches, and never more than a quarter second late while the
// status poll is running.
//
// The buffer is diagnostic history, not machine state: nothing in the ack
// ledger, the streamer or the safety notices reads it, and every teardown that
// resets the transcript clears it.

import type { LaserState } from './laser-store';
import { TRANSCRIPT_MAX, type SerialTranscriptEntry } from './laser-transcript';
import { LOG_MAX } from './laser-store-helpers';

export type TranscriptBufferRefs = {
  /** Entries recorded but not yet published, oldest first. */
  bufferedTranscript?: SerialTranscriptEntry[];
  /** Raw log lines for the same entries, in the same order. */
  bufferedLog?: string[];
};

type TranscriptPatch = Pick<LaserState, 'log' | 'transcript'>;

/** Hold one entry back from the store. `logLine` is omitted for records that
 * never appear in the operator log (outbound job chunks). */
export function bufferTranscriptEntry(
  refs: TranscriptBufferRefs,
  entry: SerialTranscriptEntry,
  logLine?: string,
): void {
  (refs.bufferedTranscript ??= []).push(entry);
  if (logLine !== undefined) (refs.bufferedLog ??= []).push(logLine);
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
  const entries = refs.bufferedTranscript ?? [];
  const logLines = refs.bufferedLog ?? [];
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
