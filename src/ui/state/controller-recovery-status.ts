import { controllerInformationActivityIsBusy } from './controller-information-activity';
import { pendingTransportWriteCount } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';

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
