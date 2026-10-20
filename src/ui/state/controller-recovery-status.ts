import { controllerInformationActivityIsBusy } from './controller-information-activity';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';
import { hostAwareSilenceRemainingMs, type StatusPollSchedule } from './laser-status-poll-schedule';

type RecoveryStatus = Pick<
  LaserState,
  | 'connection'
  | 'controllerQualification'
  | 'controllerSessionEpoch'
  | 'controllerOperation'
  | 'motionOperation'
  | 'streamer'
  | 'fireActive'
  | 'autofocusBusy'
  | 'pendingUntrackedAcks'
  | 'pendingTransportWrites'
  | 'statusObservation'
  | 'statusResponseObservation'
>;

const CONTROLLER_RESPONSE_WINDOW_MS = 8_000;
/** How long a line still owed its reply may keep the controller silent when
 * the caller passes no homing bound: the Home button's own wait for its reply
 * on a controller that reports while it homes (laser-home-action.ts). */
const OWED_REPLY_SILENCE_MS = 120_000;

/** Connection replacement follows current communication evidence, rather than
 * the kind of a persistent warning from an earlier incident. */
export function controllerReconnectRecommended(state: RecoveryStatus, now = Date.now()): boolean {
  if (state.connection.kind === 'disconnected' || state.connection.kind === 'failed') return true;
  if (state.connection.kind !== 'connected' || !currentQualificationFailed(state)) {
    return false;
  }
  // A reset that timed out without resolving old response ownership remains
  // fenced even after anonymous late acknowledgements drain its counters.
  if (state.controllerOperation !== null) {
    return (
      state.controllerOperation.kind === 'recovery' && state.controllerOperation.phase === 'reset'
    );
  }
  if (controllerInformationActivityIsBusy(state)) return false;
  // Unsettled transport or response ownership can fence Retry even while
  // realtime status still arrives. Replacement offers an explicit recovery
  // route without treating a write still in transport as an accepted command.
  if (state.pendingUntrackedAcks > 0 || pendingTransportWriteCount(state) > 0) return true;
  return controllerResponseMissing(state, now);
}

/** A connected controller that has stopped answering status queries: the one
 * controller-information condition that interrupts the operator unasked
 * (ADR-611). A settings read that failed while replies still arrive stays in
 * Controller info, out of the way, as other senders keep it. */
export function controllerStoppedResponding(state: RecoveryStatus, now = Date.now()): boolean {
  return state.connection.kind === 'connected' && controllerResponseMissing(state, now);
}

/**
 * A controller that answered status queries in this session and then stopped,
 * while nothing it owns may hold its replies: the connection bar reads "Not
 * responding" instead of "Connected" (ADR-611 Amendment 1), as other senders
 * show a stalled link. GRBL may leave `?` unanswered while it homes, and a
 * queued-poll controller is not asked while a job streams, so neither counts.
 * `owedReplySilenceMs` is the longest homing cycle the controller's settings
 * allow (the Home button's own reply wait).
 */
export function controllerWentSilent(
  state: RecoveryStatus &
    Pick<LaserState, 'capabilities'> &
    Partial<Pick<LaserState, 'transcript'>>,
  now = Date.now(),
  schedule: StatusPollSchedule | null = null,
  owedReplySilenceMs = OWED_REPLY_SILENCE_MS,
): boolean {
  if (state.connection.kind !== 'connected') return false;
  if (state.capabilities.statusQuery !== 'realtime-report' || state.controllerOperation !== null) {
    return false;
  }
  // A line still owed its reply may be what the controller is busy with: a
  // Console `$H` owns no operation, and GRBL answers neither `?` nor the `$H`
  // until homing ends. That excuses the silence only as long as homing could
  // last: a reply lost on the link never arrives and leaves the line owed for
  // the session, which must not hide a controller that then goes quiet
  // (ADR-610 Amendment 2).
  const windowMs =
    state.pendingUntrackedAcks > 0
      ? Math.max(CONTROLLER_RESPONSE_WINDOW_MS, owedReplySilenceMs)
      : CONTROLLER_RESPONSE_WINDOW_MS;
  const observed = state.statusResponseObservation ?? state.statusObservation;
  if (observed === null || observed.sessionEpoch !== state.controllerSessionEpoch) return false;
  // Any line the controller sent proves it is talking, not only a status
  // report: the `ok` that ends a Console `$H` restarts the window before the
  // next status reply arrives.
  const lastHeardAt = Math.max(observed.observedAt, lastInboundLineAt(state.transcript));
  // Only time the status poll ran on schedule counts: a hidden, throttled or
  // sleeping page asked nothing, so its gap is not the controller's silence.
  return hostAwareSilenceRemainingMs(schedule, lastHeardAt, windowMs, now) === 0;
}

function lastInboundLineAt(transcript: LaserState['transcript'] | undefined): number {
  if (transcript === undefined) return Number.NEGATIVE_INFINITY;
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const entry = transcript[index];
    if (entry?.direction === 'in') return entry.at;
  }
  return Number.NEGATIVE_INFINITY;
}

function currentQualificationFailed(state: RecoveryStatus): boolean {
  return (
    state.controllerQualification.kind === 'failed' &&
    state.controllerQualification.epoch === state.controllerSessionEpoch
  );
}

function controllerResponseMissing(state: RecoveryStatus, now: number): boolean {
  // Alarm/Sleep intentionally invalidate position authority while continuing
  // to answer status queries. Their replies still prove communication.
  const observed =
    state.statusResponseObservation === undefined
      ? state.statusObservation
      : state.statusResponseObservation;
  return (
    observed === null ||
    observed.sessionEpoch !== state.controllerSessionEpoch ||
    now - observed.observedAt >= CONTROLLER_RESPONSE_WINDOW_MS
  );
}
