// laser-parser-rearm — clears grblHAL's latched line error after a refusal.
//
// grblHAL at its default COMPATIBILITY_LEVEL 0 keeps a refused line's error in
// gc_state.last_error and answers every later G-code line with that error,
// unparsed, until an empty line, a `$` line, ASCII_CAN or a reset clears it
// (grblHAL core protocol.c:246-286 at d7aaee3d; config.h:96-98). One Console
// typo or one `$J=` past the soft limits therefore made KerfDesk's own G-code
// actions fail with a stale code: the `G4 P0.01` that releases a refused jog
// or Frame (ADR-361), Set origin, Zero Z, manual air, the Frame's `M5` and the
// Falcon's G1 jog (controller audit 2026-09-25 HF-7).
//
// After an `error:N` to a line outside a job stream, KerfDesk writes one empty
// line once every line still in flight has its reply. grblHAL answers it `ok`
// and clears the error (protocol.c:247-248). It is an owned exchange, so no
// other command can take its reply. The write waits one task so that an
// operation chaining a `$` line after the refusal (grblHAL parses those
// regardless) goes first, and it is dropped when the write epoch moves: a reset
// clears the error by itself.

import { startControllerCommand } from './laser-interactive-command';
import type { GetFn, HandlerRefs, SafeWriteFn, SetFn } from './laser-line-shared';
import { hasUnsettledStreamAcks, pushLog } from './laser-store-helpers';

/** Records a refused non-stream line on a controller that latches the error. */
export function noteRefusedLine(refs: HandlerRefs): void {
  if (refs.driver.capabilities.stickyLineError !== true) return;
  refs.parserRearmEpoch = refs.writeEpoch ?? 0;
}

/** Called after each terminal reply: re-arms once the refusal's lines drained. */
export function rearmParserWhenDrained(
  set: SetFn,
  get: GetFn,
  refs: HandlerRefs,
  safeWrite: SafeWriteFn,
): void {
  if (refs.parserRearmEpoch == null) return;
  setTimeout(() => sendParserRearm(set, get, refs, safeWrite), 0);
}

function sendParserRearm(set: SetFn, get: GetFn, refs: HandlerRefs, safeWrite: SafeWriteFn): void {
  const epoch = refs.parserRearmEpoch;
  if (epoch == null) return;
  if (epoch !== (refs.writeEpoch ?? 0)) {
    refs.parserRearmEpoch = null;
    return;
  }
  const state = get();
  if (state.connection.kind !== 'connected') return;
  // The next terminal reply tries again.
  if (state.pendingUntrackedAcks > 0 || refs.controllerCommand !== null) return;
  if (hasUnsettledStreamAcks(state.streamer)) return;
  refs.parserRearmEpoch = null;
  startControllerCommand(refs, safeWrite, {
    kind: 'interactive-command',
    label: "Clear the refused line's error",
    command: '\n',
    source: 'system',
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    set((current) => ({
      log: pushLog(current, `[lf2] Could not clear the refused line's error: ${message}`),
    }));
  });
}
