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

export const DEFAULT_RX_BUFFER_BYTES = 127;

export type StreamerStatus = 'idle' | 'streaming' | 'paused' | 'done' | 'cancelled';

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

// Try to send as many queued lines as fit in the remaining buffer. Always
// safe to call repeatedly; returns toSend = '' when nothing changed.
export function step(state: StreamerState): StepResult {
  if (state.status === 'paused' || state.status === 'done' || state.status === 'cancelled') {
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
// bumps completed. Caller decides whether to surface an error / abort on
// alarm; this function only updates state.
export function onAck(state: StreamerState, kind: AckKind): AckResult {
  if (state.inFlight.length === 0) return { state, acked: null };
  const head = state.inFlight[0];
  if (head === undefined) return { state, acked: null };
  const nextInFlight = state.inFlight.slice(1);
  const nextBytes = state.inFlightBytes - head.bytes;
  const isAlarm = kind === 'alarm';
  const completed = state.completed + 1;
  const nextStatus: StreamerStatus = isAlarm
    ? 'cancelled'
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

// Progress as a fraction [0, 1].
export function progress(state: StreamerState): number {
  if (state.total === 0) return 1;
  return state.completed / state.total;
}
