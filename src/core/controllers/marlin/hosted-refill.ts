// What the off-thread refill reads in a Marlin reply (ADR-676). Marlin streams
// ping-pong: each `ok` frees the one line in flight, so the worker that holds
// the refill writes the next line on it, as it does for FluidNC.
//
// The worker never judges a reply. Anything other than a plain `ok`, `busy`
// keepalive, position report or echo can change what the main thread does
// with the stream, so the worker hands the refill back before that line is
// forwarded:
//   - every `Error:` (a handler error, the stopped notice, kill()): the next
//     `ok` does not acknowledge a line (response.ts, ADR-395 Amendment 1);
//   - a skipped move (`Home X First`) or an unknown command: the main thread
//     turns the `ok` that follows into a rejection (MA-12);
//   - `Resend:`, which asks for a line again;
//   - a boot banner (`start`), which ends every reply still owed.
// The main thread then handles the following `ok` exactly as it does on the
// window transport, with no line sent twice or skipped.

import type { AckKind } from '../grbl/streamer';
import { classifyMarlinResponse } from './response';

/** The acknowledgement the refill counts, or null. Marlin's only one is `ok`. */
export function marlinTerminalAck(line: string): AckKind | null {
  return classifyMarlinResponse(line).kind === 'ok' ? 'ok' : null;
}

/** True when the line must reach the main thread before any further refill. */
export function marlinLineStopsHostedRefill(line: string): boolean {
  const kind = classifyMarlinResponse(line).kind;
  return kind === 'error' || kind === 'resend' || kind === 'unknown-command' || kind === 'welcome';
}
