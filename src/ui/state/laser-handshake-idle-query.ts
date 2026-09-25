// The connect handshake's wait for a fresh Idle, asking for status while it
// waits (audit TC-1).
//
// GRBL reports status only when asked (grbl protocol.c: EXEC_STATUS_REPORT) and
// the ordinary status poll starts only when the handshake returns, so the
// handshake repeats the realtime query on the status-poll cadence, one
// outstanding write at a time. The wait is bounded: a controller still busy
// after it (a long job run from the controller's own storage, a Hold, a Door,
// Check mode) is handed to the qualification scheduler, which keeps waiting
// while fresh reports arrive and qualifies on the first fresh Idle. Holding the
// handshake open instead would keep its controller operation active, and that
// operation blocks the very Console commands (`~`, `$C`) that release a Hold or
// leave Check mode.

import { cancelControllerLifecycleRefs } from './laser-interactive-command';
import type { LaserSafetyAction } from './laser-safety-notice';
import { createLaserStatusPollWriter } from './laser-status-poll-writer';
import type { LiveRefs } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

type SafeWriteFn = (
  line: string,
  action?: LaserSafetyAction,
  source?: TranscriptSource,
) => Promise<void>;

/** The status-poll cadence (laser-connection-actions STATUS_POLL_MS). */
export const HANDSHAKE_STATUS_QUERY_MS = 250;
/** How long the handshake itself waits for Idle before the scheduler takes over. */
export const HANDSHAKE_IDLE_WAIT_MS = 8_000;

/**
 * Resolves true on a fresh Idle, false when the wait ended without one: the
 * bound passed, the controller fell silent for the Idle wait's own timeout, or
 * an in-session Alarm or Sleep cancelled it. `idle` must be the wait
 * registered in `refs.controllerIdleWait` just before the call.
 */
export async function awaitHandshakeIdle(
  refs: LiveRefs,
  idle: Promise<void>,
  safeWrite: SafeWriteFn,
  realtimeQuery: string,
): Promise<boolean> {
  const request = refs.controllerIdleWait;
  const query = createLaserStatusPollWriter((line) => safeWrite(line, undefined, 'system'));
  const poll = setInterval(() => void query(realtimeQuery), HANDSHAKE_STATUS_QUERY_MS);
  const bound = setTimeout(() => {
    // Only this handshake's wait: anything that replaced or ended it owns it.
    if (request === null || refs.controllerIdleWait !== request) return;
    cancelControllerLifecycleRefs(refs, 'The controller did not report Idle during connect.');
  }, HANDSHAKE_IDLE_WAIT_MS);
  const sawIdle = await idle.then(
    () => true,
    () => false,
  );
  clearInterval(poll);
  clearTimeout(bound);
  return sawIdle;
}
