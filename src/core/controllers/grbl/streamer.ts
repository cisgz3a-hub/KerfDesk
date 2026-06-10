// GRBL character-counted streaming buffer (pure state machine).
//
// GRBL's serial RX buffer is 128 bytes (default; configurable on some forks).
// To keep the planner fed without overflowing the receiver, the sender keeps
// running tally of bytes sent but not yet acknowledged. The next line is sent
// only if it fits inside the remaining headroom. Each `ok` or `error:N` ack
// from GRBL pops the head-of-queue line and frees its bytes.
//
// This module is pure: it doesn't read or write the serial port — it answers
// "what should I do next?" given the current state. The platform/web/electron
// adapter does the actual byte I/O and feeds responses back via `onAck`.
//
// References: gnea/grbl wiki "Interface" + CNCjs streaming.js (read for
// pattern only — not vendored per ADR-017 / RESEARCH_LOG.md CNCjs entry).

// GRBL's RX buffer is 128 bytes. CNCjs uses 120 (8-byte safety margin) —
// the headroom protects against senders that occasionally add CR/LF and
// against transient queueing edge cases. We previously used 127 (1-byte
// margin) and were off-by-one in the conservative direction. MIT-compare
// audit recommended matching CNCjs. No observed bug at 127 — preventive.
export const DEFAULT_RX_BUFFER_BYTES = 120;

// 'disconnected' is distinct from 'cancelled' so the UI can show
// "job aborted — connection lost" vs the user-initiated stop. The
// streamer treats them all as terminal (no more bytes go out), but the
// reducer entry-point differs (cancel = user, disconnect = cable yank,
// error = GRBL rejected a line mid-stream / error:N, P0-1). 'errored'
// being terminal protects against a laser-on line firing at a
// mispositioned head after the rejected move. CNCjs parity per MIT-T1
// audit finding; error-as-terminal matches LightBurn.
export type StreamerStatus =
  | 'idle'
  | 'streaming'
  | 'paused'
  | 'done'
  | 'cancelled'
  | 'disconnected'
  | 'errored';

export type StreamerState = {
  readonly status: StreamerStatus;
  // Lines remaining to send, each already terminated with '\n'.
  readonly queued: ReadonlyArray<string>;
  // Lines sent but not yet ack'd, head-first.
  readonly inFlight: ReadonlyArray<{ readonly line: string; readonly bytes: number }>;
  // Total bytes currently in-flight (sum of inFlight[].bytes).
  readonly inFlightBytes: number;
  // Lines that have been acknowledged (ok or error). Drives progress UI.
  readonly completed: number;
  // Total line count at start of stream (for progress %).
  readonly total: number;
  readonly rxBufferBytes: number;
};

export type AckKind = 'ok' | 'error' | 'alarm';

export type StepResult = {
  readonly state: StreamerState;
  // Bytes to write to the serial port (concatenated lines). Empty if nothing
  // fits right now or we're paused/done.
  readonly toSend: string;
};

export type AckResult = {
  readonly state: StreamerState;
  // The line that was just acknowledged (head of in-flight), or null if the
  // ack arrived with nothing in flight (unsolicited ok).
  readonly acked: string | null;
};

export function createStreamer(
  gcode: string,
  opts: { readonly rxBufferBytes?: number } = {},
): StreamerState {
  const lines = splitLines(gcode);
  return {
    status: lines.length === 0 ? 'done' : 'idle',
    queued: lines,
    inFlight: [],
    inFlightBytes: 0,
    completed: 0,
    total: lines.length,
    rxBufferBytes: opts.rxBufferBytes ?? DEFAULT_RX_BUFFER_BYTES,
  };
}

function splitLines(gcode: string): ReadonlyArray<string> {
  return gcode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith(';'))
    .map((l) => `${l}\n`);
}

export type OversizedLine = {
  // 1-based index among the sendable (non-comment, non-blank) lines.
  readonly lineNumber: number;
  readonly bytes: number;
  readonly limit: number;
};

// M13 (AUDIT-2026-06-10): a line longer than the RX buffer can never satisfy
// step()'s send condition — the loop breaks with nothing sent, no error, no
// state change. Callers must check BEFORE creating a streamer so the job is
// refused loudly instead of freezing at 0/N.
export function findOversizedLine(
  gcode: string,
  rxBufferBytes: number = DEFAULT_RX_BUFFER_BYTES,
): OversizedLine | null {
  const lines = splitLines(gcode);
  for (let i = 0; i < lines.length; i += 1) {
    const bytes = lines[i]?.length ?? 0;
    if (bytes > rxBufferBytes) return { lineNumber: i + 1, bytes, limit: rxBufferBytes };
  }
  return null;
}

// Terminal statuses are absorbing: once the stream is done, cancelled,
// disconnected, or errored, no ack may move it anywhere else. H5
// (AUDIT-2026-06-10): without this, the ok acks trailing an error:N in the
// final RX window drained the queue and promoted the stream back to 'done',
// reporting a clean finish over a real rejection.
function isTerminal(status: StreamerStatus): boolean {
  return (
    status === 'done' || status === 'cancelled' || status === 'disconnected' || status === 'errored'
  );
}

// Try to send as many queued lines as fit in the remaining buffer. Always
// safe to call repeatedly; returns toSend = '' when nothing changed.
export function step(state: StreamerState): StepResult {
  if (state.status === 'paused' || isTerminal(state.status)) {
    return { state, toSend: '' };
  }
  let queued = state.queued;
  let inFlight = state.inFlight;
  let inFlightBytes = state.inFlightBytes;
  const sentChunks: string[] = [];
  while (queued.length > 0) {
    const next = queued[0];
    if (next === undefined) break;
    const bytes = next.length;
    if (inFlightBytes + bytes > state.rxBufferBytes) break;
    sentChunks.push(next);
    inFlight = [...inFlight, { line: next, bytes }];
    inFlightBytes += bytes;
    queued = queued.slice(1);
  }
  if (sentChunks.length === 0) return { state, toSend: '' };
  return {
    state: {
      ...state,
      status: 'streaming',
      queued,
      inFlight,
      inFlightBytes,
    },
    toSend: sentChunks.join(''),
  };
}

// Consume one ack from GRBL (ok / error / alarm). Decrements in-flight,
// bumps completed. An 'alarm' ack makes the stream terminal ('cancelled')
// and an 'error' ack makes it terminal ('errored') - GRBL rejected the
// line, so no further bytes may be sent (P0-1). Terminal statuses absorb
// later acks: buffer accounting still runs (GRBL freed the bytes), but the
// status cannot change — trailing oks after an error must not report a
// clean finish (H5). The caller still decides how to SURFACE the failure
// (e.g. a safety notice); this only updates state so step() refuses to
// send more.
export function onAck(state: StreamerState, kind: AckKind): AckResult {
  if (state.inFlight.length === 0) return { state, acked: null };
  const head = state.inFlight[0];
  if (head === undefined) return { state, acked: null };
  const nextInFlight = state.inFlight.slice(1);
  const nextBytes = state.inFlightBytes - head.bytes;
  const completed = state.completed + 1;
  const nextStatus: StreamerStatus = isTerminal(state.status)
    ? state.status
    : kind === 'alarm'
      ? 'cancelled'
      : kind === 'error'
        ? 'errored'
        : nextInFlight.length === 0 && state.queued.length === 0
          ? 'done'
          : state.status;
  return {
    state: {
      ...state,
      inFlight: nextInFlight,
      inFlightBytes: nextBytes,
      completed,
      status: nextStatus,
    },
    acked: head.line,
  };
}

export function pause(state: StreamerState): StreamerState {
  if (state.status !== 'streaming' && state.status !== 'idle') return state;
  return { ...state, status: 'paused' };
}

export function resume(state: StreamerState): StreamerState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'streaming' };
}

export function cancel(state: StreamerState): StreamerState {
  return { ...state, status: 'cancelled', queued: [] };
}

// Mark the streamer disconnected — used when the serial port drops
// mid-stream (cable yank, OS sleep). Same shape as cancel() at the
// data layer (queued lines cleared), but the status distinguishes
// involuntary loss from user-initiated stop so the UI can word the
// notification correctly. MIT-T1 audit finding (CNCjs parity).
export function disconnect(state: StreamerState): StreamerState {
  return { ...state, status: 'disconnected', queued: [] };
}

// Mark the streamer errored without consuming an ack — used when a
// refill write fails mid-job. Unlike disconnect(), 'errored' stays
// inside isActiveJob, so the Stop button and the soft-reset stop
// command remain available: the port may still be alive and GRBL may
// still be executing its buffered lines (AUDIT-VERIFICATION-2026-06-10,
// HD1-adjacent finding).
export function markErrored(state: StreamerState): StreamerState {
  return { ...state, status: 'errored', queued: [] };
}

// Progress as a fraction [0, 1].
export function progress(state: StreamerState): number {
  if (state.total === 0) return 1;
  return state.completed / state.total;
}
