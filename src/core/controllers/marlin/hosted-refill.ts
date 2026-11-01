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
//   - a skipped move (`Home X First`): the main thread turns the `ok` that
//     follows into a rejection (MA-12);
//   - an unknown command that names the line in flight, which the main thread
//     rejects the same way (MA-12);
//   - `Resend:`, which asks for a line again;
//   - a boot banner (`start`), which ends every reply still owed.
// The main thread then handles the following `ok` exactly as it does on the
// window transport, with no line sent twice or skipped.
//
// An unknown-command echo of any other text stays only in the main thread's
// log, and the stream goes on: Marlin echoes the bytes it read, so a command
// letter lost on the wire turns `G1 X14 Y50` into `1 X14 Y50`. Handing the
// refill back for that left the rest of the job on the window with nothing
// said (rolling audit v8 N1-P1-1, ADR-676 Amendment 1). The worker keeps the
// refill instead, by the test the main thread applies to the same line
// (`echoedCommandMatchesLine`), so the two sides cannot disagree.

import { echoedCommandMatchesLine } from '../controller-event';
import type { AckKind } from '../grbl/streamer';
import { classifyMarlinResponse } from './response';

/** The acknowledgement the refill counts, or null. Marlin's only one is `ok`. */
export function marlinTerminalAck(line: string): AckKind | null {
  return classifyMarlinResponse(line).kind === 'ok' ? 'ok' : null;
}

/** True when the line must reach the main thread before any further refill.
 * `inFlight` is the oldest line still owed an `ok`, the one a reply is about. */
export function marlinLineStopsHostedRefill(line: string, inFlight: string | undefined): boolean {
  const event = classifyMarlinResponse(line);
  if (event.kind === 'unknown-command') {
    return inFlight !== undefined && echoedCommandMatchesLine(event.command, inFlight);
  }
  return event.kind === 'error' || event.kind === 'resend' || event.kind === 'welcome';
}
