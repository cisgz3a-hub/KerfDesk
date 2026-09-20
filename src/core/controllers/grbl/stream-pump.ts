// stream-pump — the character-counting refill loop as one pure step (ADR-334).
//
// This is the only work that has to happen between a controller's `ok` landing
// and the next bytes going out. Everything else the app does with that line —
// the acknowledgement ledger, progress, recovery checkpoints, safety notices,
// the console — can happen afterwards without the machine noticing.
//
// It was previously inlined in `advanceStream`, which runs on the renderer's
// main thread behind every store update and React render that the same line
// triggers. Extracted here it can also run inside the serial worker, where
// nothing else competes for the thread: the worker writes the refill, then
// tells the main thread what arrived. The algorithm is identical in both
// places because both call these functions on the same line sequence from the
// same starting state, and `onAck` / `step` are pure.
//
// The pump deliberately knows nothing about transports, stores or safety
// policy. It reads a line, decides whether it was a terminal acknowledgement,
// and returns the next bytes.

import { classifyResponse } from './response';
import { onAck, step, type AckKind, type StreamerState } from './streamer';

export type StreamPumpResult = {
  readonly streamer: StreamerState;
  /** Bytes to put on the wire now. Empty when nothing fits or nothing is due. */
  readonly toSend: string;
  /** True when the line was a terminal acknowledgement the streamer consumed. */
  readonly consumedAck: boolean;
};

/**
 * The three-way split the streamer's accounting needs, or null for a line that
 * is not a terminal acknowledgement (a status report, a message, a banner).
 *
 * GRBL-family wire protocol: `ok`, `error:N`, `ALARM:N`. Firmwares outside
 * that family are not pumped — the hosted path is offered only for the GRBL
 * family, whose acknowledgement shape this matches.
 */
export function terminalAckKind(line: string): AckKind | null {
  const kind = classifyResponse(line).kind;
  return kind === 'ok' || kind === 'error' || kind === 'alarm' ? kind : null;
}

/** Consume one inbound line. A line that is not a terminal acknowledgement
 * leaves the streamer untouched and sends nothing. */
export function pumpInboundLine(streamer: StreamerState, line: string): StreamPumpResult {
  const kind = terminalAckKind(line);
  if (kind === null) return { streamer, toSend: '', consumedAck: false };
  const stepped = step(onAck(streamer, kind).state);
  return { streamer: stepped.state, toSend: stepped.toSend, consumedAck: true };
}

/** The first window: whatever fits before any acknowledgement has arrived. */
export function pumpFirstWindow(streamer: StreamerState): StreamPumpResult {
  const stepped = step(streamer);
  return { streamer: stepped.state, toSend: stepped.toSend, consumedAck: false };
}
