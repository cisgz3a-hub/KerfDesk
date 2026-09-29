// laser-serial-line-errors — UART line errors the transport survived. Web
// Serial's BreakError, BufferOverrunError, FramingError and ParityError leave
// the port open and reading goes on (serial-read-recovery.ts), but the bytes
// at the error are gone. GRBL answers every line with exactly one `ok` or
// `error:N`
// (https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L9),
// so a lost `ok` leaves its line unacknowledged and the stream waiting, and a
// lost `error:N` is a rejection nobody sees. The error used to reach only the
// developer console (controller audit T-3, ADR-375). It is now a Console
// notice, a stream hold in the same job names it (laser-stream-hold.ts), and a
// silent connect that saw only line errors points at the baud rate
// (laser-controller-silence.ts). Nothing here writes to the controller or
// refuses anything.

import type { SerialConnection } from '../../platform/types';
import type { LaserState } from './laser-store';
import { systemTranscriptEntry } from './laser-transcript';
import { publishTranscriptPatch, type TranscriptBufferRefs } from './laser-transcript-buffer';

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type Epochs = Pick<LaserState, 'controllerSessionEpoch' | 'streamerEpoch'>;
type ConnectionRefs = { readonly connection?: SerialConnection | null };
type NoticeRefs = ConnectionRefs & TranscriptBufferRefs & { nextTranscriptId?: number };

type LineErrorRecord = {
  readonly connection: SerialConnection;
  readonly name: string;
  /** Controller session and job the error happened in. */
  readonly sessionEpoch: number;
  readonly streamerEpoch: number;
  /** When the Console last named a line error, and how many arrived since. */
  readonly loggedAt: number;
  readonly unlogged: number;
};

// Kept off the reactive state (laser-store.ts stays at its size cap): only the
// notice and a stream hold show it. Keyed by the store's refs, so independent
// stores never share a record, and bound to the connection that reported it.
const records = new WeakMap<object, LineErrorRecord>();

// A noisy link can raise many errors a second; one notice per window keeps the
// Console readable and still counts the rest.
export const LINE_ERROR_NOTICE_INTERVAL_MS = 5_000;

/** Records the line errors `connection` reports while it is the live one. */
export function observeSerialLineErrors(
  set: SetFn,
  get: () => Epochs,
  refs: NoticeRefs,
  connection: SerialConnection,
): void {
  connection.onLineError?.((name) => {
    if (refs.connection !== connection) return;
    recordSerialLineError(set, get(), refs, connection, name, Date.now());
  });
}

function recordSerialLineError(
  set: SetFn,
  epochs: Epochs,
  refs: NoticeRefs,
  connection: SerialConnection,
  name: string,
  now: number,
): void {
  const previous = sessionRecord(refs, epochs.controllerSessionEpoch);
  const quiet = previous !== null && now - previous.loggedAt < LINE_ERROR_NOTICE_INTERVAL_MS;
  records.set(refs, {
    connection,
    name,
    sessionEpoch: epochs.controllerSessionEpoch,
    streamerEpoch: epochs.streamerEpoch,
    loggedAt: quiet ? previous.loggedAt : now,
    unlogged: quiet ? previous.unlogged + 1 : 0,
  });
  if (quiet) return;
  const line =
    `[lf2] Serial line error (${name}): bytes from the controller were lost; the port is still ` +
    'open and reading continues. A reply lost with them is never seen, so a line may stay ' +
    `unacknowledged.${unloggedSince(previous)}`;
  const id = refs.nextTranscriptId ?? 1;
  refs.nextTranscriptId = id + 1;
  // After any job acknowledgements still held back, so the Console keeps wire
  // order (ADR-333).
  set((state) =>
    publishTranscriptPatch(refs, state, systemTranscriptEntry(id, now, line, 'message'), line),
  );
}

function unloggedSince(previous: LineErrorRecord | null): string {
  const count = previous?.unlogged ?? 0;
  if (count === 0) return '';
  return ` ${count} more line error${count === 1 ? '' : 's'} since the last report.`;
}

function sessionRecord(refs: ConnectionRefs, sessionEpoch: number): LineErrorRecord | null {
  const record = records.get(refs) ?? null;
  if (record === null || record.connection !== refs.connection) return null;
  return record.sessionEpoch === sessionEpoch ? record : null;
}

/** The latest line error of the job now streaming, if any. */
export function currentJobLineError(refs: ConnectionRefs, state: Epochs): string | null {
  const record = sessionRecord(refs, state.controllerSessionEpoch);
  return record !== null && record.streamerEpoch === state.streamerEpoch ? record.name : null;
}

/** Whether this controller session saw any line error, for connect diagnostics. */
export function sessionSawLineError(
  refs: ConnectionRefs,
  state: Pick<LaserState, 'controllerSessionEpoch'>,
): boolean {
  return sessionRecord(refs, state.controllerSessionEpoch) !== null;
}
