// console-status-follow-up — one status query straight after a Console
// command's reply (annoyance audit A3-P2-4, ADR-674 Amendment 1).
//
// A Console command that can change the machine makes the store forget the
// last status report (consoleObservationPatch): a write is no proof that the
// motion or mode change it asked for has finished, so the next jog, Frame or
// Console line needs a report made after it. On an idle machine the background
// poll asks only once a second, so Send and the jog pad stayed off for up to a
// second after every line.
//
// This asks once, as soon as the controller has answered the command, and only
// while the report is still missing. It does not replace the rule: the report
// is still the controller's own, and it is still made after the command was
// taken. Waiting for the reply matters. A status byte is answered ahead of the
// line queue, so one sent with the command could report the Idle from before
// the command began.
//
// It stays out of every exchange that owns the status boundary: a job, a jog
// or Frame, auto-focus and a probe are already polled four times a second, and
// an owned controller operation (a `$$` re-read after a setting write) may own
// polling outright.
//
// Only a realtime status query is sent. A controller with only a queued one
// (Marlin's M114) keeps its ordinary poll: M114 is a line that owes its own
// `ok`, and it reports the planned position, not whether motion has finished,
// so asking it sooner would end the wait sooner without making it more true.

import type { ControllerDriver } from '../../core/controllers';
import type { LaserSafetyAction } from './laser-safety-notice';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import { controllerOperationOwnsPolling, shouldFastPoll } from './laser-status-polling-policy';
import type { LaserState } from './laser-store';
import type { TranscriptSource } from './laser-transcript';

const REPLY_POLL_MS = 10;
/** The idle poll's own period. Past it the poll has asked anyway. */
export const CONSOLE_STATUS_FOLLOW_UP_WINDOW_MS = 1_000;

type FollowUpWrite = (
  line: string,
  action: LaserSafetyAction | undefined,
  source: TranscriptSource,
) => Promise<void>;
type FollowUpRefs = {
  readonly driver: ControllerDriver;
  readonly controllerCommand?: unknown;
};

/** Sends one status query once the Console command's reply has arrived, if
 *  the machine is otherwise quiet and no report has come by then. */
export async function requestStatusAfterConsoleReply(
  get: () => LaserState,
  refs: FollowUpRefs,
  write: FollowUpWrite,
): Promise<void> {
  const query = refs.driver.realtime.statusQuery;
  if (query === null) return;
  const sessionEpoch = get().controllerSessionEpoch;
  const deadline = Date.now() + CONSOLE_STATUS_FOLLOW_UP_WINDOW_MS;
  for (;;) {
    const state = get();
    if (!stillWanted(state, sessionEpoch)) return;
    if (replySettled(state, refs)) break;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => setTimeout(resolve, REPLY_POLL_MS));
  }
  try {
    await write(query, undefined, 'system');
  } catch {
    // The periodic poll is still running; a failed query is not a refusal.
  }
}

// Nothing to do once a report has arrived, the session has moved on, or an
// exchange that polls for itself owns the machine.
function stillWanted(state: LaserState, sessionEpoch: number): boolean {
  return (
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === sessionEpoch &&
    state.statusReport === null &&
    !shouldFastPoll(state) &&
    !controllerOperationOwnsPolling(state)
  );
}

// Every line KerfDesk wrote has been answered and nothing is still on its way
// out, so the controller has taken the Console command.
function replySettled(state: LaserState, refs: FollowUpRefs): boolean {
  return (
    state.pendingUntrackedAcks === 0 &&
    pendingTransportWriteCount(state) === 0 &&
    (refs.controllerCommand ?? null) === null
  );
}
