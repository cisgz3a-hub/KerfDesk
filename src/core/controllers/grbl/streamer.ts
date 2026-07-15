import {
  DEFAULT_GRBL_RX_BUFFER_BYTES,
  normalizeGrblRxBufferBytes,
  type GrblStreamingMode,
} from '../../grbl-streaming';

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
export const DEFAULT_RX_BUFFER_BYTES = DEFAULT_GRBL_RX_BUFFER_BYTES;

// 'disconnected' is distinct from 'cancelled' so the UI can show
// "job aborted — connection lost" vs the user-initiated stop. The
// streamer treats them all as terminal (no more bytes go out), but the
// reducer entry-point differs (cancel = user, disconnect = cable yank,
// errored = GRBL rejected a line mid-stream / error:N (P0-1) or a
// refill write failed on a possibly-live port (markErrored)). 'errored'
// being terminal protects against a laser-on line firing at a
// mispositioned head after the rejected move, while keeping the in-app
// Stop path mounted. CNCjs parity per MIT-T1 audit finding;
// error-as-terminal matches LightBurn.
// 'tool-change' is a non-terminal hold at an M0 boundary in a multi-bit CNC
// job (CNC-01). The sender does NOT send the M0: it stops feeding and leaves
// the M0 at the queue head, so GRBL drains the retract/M5/park that precede it
// and settles to Idle — the only state in which it will accept the jog/probe/
// G92 the operator needs to re-zero the new bit. A plain GRBL feed-hold (M0's
// own effect) leaves the controller in Hold, where re-zeroing is impossible.
// continueToolChange() drops the M0 and resumes; the emitter's spindle-off
// safe-Z lift precedes its M3/G4 spin-up.
export type StreamerStatus =
  | 'idle'
  | 'streaming'
  | 'paused'
  | 'tool-change'
  | 'done'
  | 'cancelled'
  | 'disconnected'
  | 'errored';

export type StreamerState = {
  readonly status: StreamerStatus;
  readonly streamingMode: StreamingMode;
  // Immutable lines for the complete stream, each already terminated with '\n'.
  // queueIndex identifies the next unsent line. Keeping one backing array makes
  // every dequeue O(1) instead of copying the entire remaining job.
  readonly queued: ReadonlyArray<string>;
  readonly queueIndex: number;
  // Lines sent but not yet ack'd, head-first.
  readonly inFlight: ReadonlyArray<{ readonly line: string; readonly bytes: number }>;
  // Total bytes currently in-flight (sum of inFlight[].bytes).
  readonly inFlightBytes: number;
  // Lines that have been acknowledged (ok or error). Drives progress UI.
  readonly completed: number;
  // Total line count at start of stream (for progress %).
  readonly total: number;
  readonly rxBufferBytes: number;
  // When true, a lone M0/M1 is treated as a tool-change boundary (swallowed,
  // stream held at Idle) instead of being sent. Set only for KerfDesk-emitted
  // CNC jobs — an imported .nc program's M0/M1 is an ordinary program pause and
  // must stream through unchanged.
  readonly toolChangePause: boolean;
};

export type StreamingMode = GrblStreamingMode;
export type CreateStreamerOptions = {
  readonly rxBufferBytes?: number;
  readonly streamingMode?: StreamingMode;
  readonly toolChangePause?: boolean;
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

export function createStreamer(gcode: string, opts: CreateStreamerOptions = {}): StreamerState {
  const lines = splitLines(gcode);
  return {
    status: lines.length === 0 ? 'done' : 'idle',
    streamingMode: opts.streamingMode ?? 'char-counted',
    queued: lines,
    queueIndex: 0,
    inFlight: [],
    inFlightBytes: 0,
    completed: 0,
    total: lines.length,
    rxBufferBytes: normalizeGrblRxBufferBytes(opts.rxBufferBytes),
    toolChangePause: opts.toolChangePause ?? false,
  };
}

// A lone program-stop (M0) or optional-stop (M1). GrblStrategy emits a bare
// `M0` between bit sections (the human-readable instructions before it are
// comments, already filtered out of the queue). Comment-stripped and trimmed
// so an imported `M0 ; change bit` still matches.
function isToolChangeLine(line: string): boolean {
  const code = line
    .replace(/\(.*?\)/g, '')
    .replace(/;.*$/, '')
    .trim()
    .toUpperCase();
  return code === 'M0' || code === 'M00' || code === 'M1' || code === 'M01';
}

// The single definition of "sendable": blank lines and full-line comments are
// never streamed, so `completed`/`total` count ONLY lines this accepts. The
// job-checkpoint mapper (core/recovery, ADR-118) uses the same predicate to
// convert an acked-sendable count back to a raw file line number — the two
// MUST NOT drift.
export function isSendableGcodeLine(rawLine: string): boolean {
  const trimmed = rawLine.trim();
  return trimmed !== '' && !trimmed.startsWith(';');
}

function splitLines(gcode: string): ReadonlyArray<string> {
  return gcode
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => isSendableGcodeLine(l))
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
  const limit = normalizeGrblRxBufferBytes(rxBufferBytes);
  const lines = splitLines(gcode);
  for (let i = 0; i < lines.length; i += 1) {
    const bytes = lines[i]?.length ?? 0;
    if (bytes > limit) return { lineNumber: i + 1, bytes, limit };
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

type FillResult = {
  readonly queueIndex: number;
  readonly inFlight: ReadonlyArray<{ readonly line: string; readonly bytes: number }>;
  readonly inFlightBytes: number;
  readonly sent: ReadonlyArray<string>;
  // True when the batch stopped at a lone M0 (toolChangePause) — the M0 is left
  // at the head of `queued`, never sent.
  readonly hitToolChange: boolean;
};

// Greedily batch queued lines that fit the remaining RX buffer. Stops early at
// a tool-change M0 (leaving it queued) or when the next line won't fit.
function fillBuffer(state: StreamerState): FillResult {
  let queueIndex = state.queueIndex;
  let inFlight = state.inFlight;
  let inFlightBytes = state.inFlightBytes;
  const sent: string[] = [];
  while (queueIndex < state.queued.length) {
    if (state.streamingMode === 'ping-pong' && sent.length > 0) break;
    const next = state.queued[queueIndex];
    if (next === undefined) break;
    // The M0 must NOT be sent: detected inside the loop, not at the top, because
    // in char-counted mode the retract/M5/park/M0 are all tiny and would batch
    // into one chunk with the M0.
    if (state.toolChangePause && isToolChangeLine(next)) {
      return { queueIndex, inFlight, inFlightBytes, sent, hitToolChange: true };
    }
    const bytes = next.length;
    if (inFlightBytes + bytes > state.rxBufferBytes) break;
    sent.push(next);
    inFlight = [...inFlight, { line: next, bytes }];
    inFlightBytes += bytes;
    queueIndex += 1;
  }
  return { queueIndex, inFlight, inFlightBytes, sent, hitToolChange: false };
}

// Try to send as many queued lines as fit in the remaining buffer. Always
// safe to call repeatedly; returns toSend = '' when nothing changed.
export function step(state: StreamerState): StepResult {
  if (state.status === 'paused' || state.status === 'tool-change' || isTerminal(state.status)) {
    return { state, toSend: '' };
  }
  if (state.streamingMode === 'ping-pong' && state.inFlight.length > 0) {
    return { state, toSend: '' };
  }
  const { queueIndex, inFlight, inFlightBytes, sent, hitToolChange } = fillBuffer(state);
  const toSend = sent.join('');
  // Return the tool-change transition explicitly even when nothing was sent
  // (the M0 was first this call) — otherwise the empty-send guard below would
  // drop the transition and re-return the un-held original state.
  if (hitToolChange) {
    return {
      state: { ...state, status: 'tool-change', queueIndex, inFlight, inFlightBytes },
      toSend,
    };
  }
  if (sent.length === 0) return { state, toSend: '' };
  return {
    state: { ...state, status: 'streaming', queueIndex, inFlight, inFlightBytes },
    toSend,
  };
}

// Leave a tool-change hold: drop the un-sent M0 from the queue head and count
// it complete (it is a sendable line, so `total` counted it; never sending it
// would otherwise strand `completed/total` one short forever), then hand back
// to step() to resume from the safe-Z/M3/G4 sequence placed after the M0.
export function continueToolChange(state: StreamerState): StreamerState {
  if (state.status !== 'tool-change') return state;
  return {
    ...state,
    status: 'streaming',
    queueIndex: state.queueIndex + 1,
    completed: state.completed + 1,
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
  // GRBL keeps acking held-but-parsed lines during a feed hold, so a paused
  // stream routinely drains its in-flight tail while lines stay queued. An
  // alarm/error arriving then consumes no line, but terminality must not
  // depend on having one — otherwise resume() stays legal and streams the
  // queue into a locked controller.
  if (state.inFlight.length === 0) return { state: ackStatusWithoutLine(state, kind), acked: null };
  const head = state.inFlight[0];
  if (head === undefined) return { state: ackStatusWithoutLine(state, kind), acked: null };
  // ALARM:N means the firmware discarded its RX buffer and planner: the
  // remaining in-flight lines will never be acked. Wipe them all (audit F1)
  // — keeping them would make the store's ack-attribution layer claim every
  // later untracked ack ($X unlock, M9 cleanup) for this dead stream.
  const nextInFlight = kind === 'alarm' ? [] : state.inFlight.slice(1);
  const nextBytes = kind === 'alarm' ? 0 : state.inFlightBytes - head.bytes;
  const completed = state.completed + 1;
  // A paused stream never promotes to 'done': GRBL acks held-but-parsed
  // lines during a feed hold, so pausing near the end of a job drains the
  // queues while the machine still holds unexecuted planner motion. resume()
  // completes a drained stream instead.
  const nextStatus: StreamerStatus = isTerminal(state.status)
    ? state.status
    : kind === 'alarm'
      ? 'cancelled'
      : kind === 'error'
        ? 'errored'
        : state.status !== 'paused' &&
            state.status !== 'tool-change' &&
            nextInFlight.length === 0 &&
            queuedLineCount(state) === 0
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

function ackStatusWithoutLine(state: StreamerState, kind: AckKind): StreamerState {
  if (kind === 'ok' || isTerminal(state.status)) return state;
  return kind === 'alarm' ? cancel(state) : markErrored(state);
}

export function pause(state: StreamerState): StreamerState {
  // `done` means every line was accepted, not that GRBL finished executing
  // planner motion. The UI keeps that tail active until a later Idle report,
  // so it must remain pausable while the controller still reports Run.
  if (state.status !== 'streaming' && state.status !== 'idle' && state.status !== 'done') {
    return state;
  }
  return { ...state, status: 'paused' };
}

export function resume(state: StreamerState): StreamerState {
  if (state.status !== 'paused') return state;
  // Everything was already delivered and acked during the hold — resuming
  // has nothing left to send, so the stream completes here. The job lock
  // still holds until the machine reports Idle (the caller's release path),
  // because the resumed planner motion is still executing.
  if (state.inFlight.length === 0 && queuedLineCount(state) === 0) {
    return { ...state, status: 'done' };
  }
  return { ...state, status: 'streaming' };
}

export function cancel(state: StreamerState): StreamerState {
  return { ...state, status: 'cancelled', queued: [], queueIndex: 0 };
}

// Mark the streamer disconnected — used when the serial port drops
// mid-stream (cable yank, OS sleep). Same shape as cancel() at the
// data layer (queued lines cleared), but the status distinguishes
// involuntary loss from user-initiated stop so the UI can word the
// notification correctly. MIT-T1 audit finding (CNCjs parity).
export function disconnect(state: StreamerState): StreamerState {
  return { ...state, status: 'disconnected', queued: [], queueIndex: 0 };
}

// Mark the streamer errored without consuming an ack — used when a
// refill write fails mid-job. Unlike disconnect(), 'errored' stays
// inside isActiveJob, so the Stop button and the soft-reset stop
// command remain available: the port may still be alive and GRBL may
// still be executing its buffered lines (AUDIT-VERIFICATION-2026-06-10,
// HD1-adjacent finding).
export function markErrored(state: StreamerState): StreamerState {
  return { ...state, status: 'errored', queued: [], queueIndex: 0 };
}

export function queuedLineCount(state: StreamerState): number {
  return Math.max(0, state.queued.length - state.queueIndex);
}

export function nextQueuedLine(state: StreamerState): string | undefined {
  return state.queued[state.queueIndex];
}

export function remainingQueuedLines(state: StreamerState): ReadonlyArray<string> {
  return state.queued.slice(state.queueIndex);
}

// Clear in-flight accounting after the firmware provably wiped its receive
// buffer (soft reset, ALARM) — those lines will never be acked, so leaving
// them "in flight" makes hasUnsettledStreamAcks claim future untracked acks
// for a dead stream (audit F1). Status is untouched; compose with cancel()
// or markErrored() at the call site. NOT for stream-side stops (Marlin):
// there the firmware still acks the in-flight lines and the accounting must
// wait for them.
export function wipeInFlight(state: StreamerState): StreamerState {
  return { ...state, inFlight: [], inFlightBytes: 0 };
}

// Progress as a fraction [0, 1].
export function progress(state: StreamerState): number {
  if (state.total === 0) return 1;
  return state.completed / state.total;
}
