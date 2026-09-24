import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';
import { pendingTransportWriteCount } from './laser-start-queue-fence';

export type ControllerQualificationPhase =
  | 'controller-response'
  | 'reset-cleanup'
  | 'settings-read';

export type ControllerQualification =
  | { readonly kind: 'disconnected'; readonly epoch: number }
  | {
      readonly kind: 'qualifying';
      readonly epoch: number;
      readonly phase: ControllerQualificationPhase;
    }
  | {
      readonly kind: 'qualified';
      readonly epoch: number;
      readonly settings: 'verified' | 'not-required';
    }
  | { readonly kind: 'failed'; readonly epoch: number; readonly message: string };

export type ControllerQualificationScheduleRefs = {
  readonly connection?: unknown | null;
  qualificationTimer?: ReturnType<typeof setTimeout> | null;
  qualificationDeadline?: number | null;
  runControllerQualification?: (() => Promise<void>) | null;
};

type SetFn = (
  partial: Partial<LaserState> | ((state: LaserState) => Partial<LaserState> | LaserState),
) => void;
type GetFn = () => LaserState;

const QUALIFICATION_READY_POLL_MS = 50;
const QUALIFICATION_READY_TIMEOUT_MS = 8_000;

export function disconnectedControllerQualification(epoch: number): ControllerQualification {
  return { kind: 'disconnected', epoch };
}

export function qualifyingController(
  epoch: number,
  phase: ControllerQualificationPhase,
): ControllerQualification {
  return { kind: 'qualifying', epoch, phase };
}

export function qualifiedController(
  epoch: number,
  settings: 'verified' | 'not-required',
): ControllerQualification {
  return { kind: 'qualified', epoch, settings };
}

export function controllerQualificationStartBlockMessage(
  qualification: ControllerQualification,
  currentEpoch: number,
): string | null {
  if (qualification.kind === 'qualified' && qualification.epoch === currentEpoch) return null;
  if (qualification.kind === 'qualifying') {
    return qualification.phase === 'settings-read'
      ? 'Reading controller settings…'
      : 'Controller qualification is still in progress…';
  }
  if (qualification.kind === 'failed') {
    return `Controller qualification failed: ${qualification.message}`;
  }
  return 'Controller qualification is not current. Reconnect or retry reading controller settings.';
}

// Frame-first (2026-07-17): ordinary Starts on BOTH machine kinds carry
// absent settings evidence as Job Review warnings; qualification no longer
// gates the normal Start on either. controllerQualificationStartBlockMessage
// above remains in use by the supervised-recovery flows, whose re-entry
// semantics still require fresh qualification.

export function failedControllerQualificationPatch(
  state: LaserState,
  expectedEpoch: number,
  message: string,
): Partial<LaserState> {
  if (
    state.connection.kind !== 'connected' ||
    state.controllerSessionEpoch !== expectedEpoch ||
    state.controllerQualification.epoch !== expectedEpoch
  ) {
    return {};
  }
  return { controllerQualification: { kind: 'failed', epoch: expectedEpoch, message } };
}

export function scheduleControllerQualification(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  epoch: number,
): void {
  cancelScheduledControllerQualification(refs);
  refs.qualificationDeadline = Date.now() + QUALIFICATION_READY_TIMEOUT_MS;
  const poll = (): void => {
    refs.qualificationTimer = null;
    const state = get();
    if (!qualificationScheduleIsCurrent(state, refs, epoch)) {
      refs.qualificationDeadline = null;
      return;
    }
    if (qualificationIsTerminal(state.controllerQualification)) {
      refs.qualificationDeadline = null;
      return;
    }
    const controllerBusy = controllerQualificationIsBusy(state);
    if (controllerBusy || waitingOnOperator(state)) {
      refs.qualificationDeadline = Date.now() + QUALIFICATION_READY_TIMEOUT_MS;
    }
    if (!controllerBusy && state.statusReport?.state === 'Idle') {
      refs.qualificationDeadline = null;
      const run = refs.runControllerQualification;
      if (run == null) return;
      void run().catch(() => undefined);
      return;
    }
    if (Date.now() >= (refs.qualificationDeadline ?? 0)) {
      refs.qualificationDeadline = null;
      set((current) =>
        failedControllerQualificationPatch(
          current,
          epoch,
          'The controller did not reach fresh Idle in time. Check the connection, then retry reading controller settings.',
        ),
      );
      return;
    }
    refs.qualificationTimer = setTimeout(poll, QUALIFICATION_READY_POLL_MS);
  };
  refs.qualificationTimer = setTimeout(poll, QUALIFICATION_READY_POLL_MS);
}

/**
 * An Alarm or Sleep status during the connect handshake moves the write epoch
 * but not the session epoch (no reboot). The handshake cannot tell that from a
 * stale await, so it returned silently and left qualification at "Waiting for
 * controller response…" forever when a board that does not reset on open was
 * locked in Alarm or Sleep (audit connect-2). The same connection and session,
 * with qualification still pending for it, is an in-session invalidation: the
 * scheduler runs qualification on the first fresh Idle once the operator
 * unlocks, homes or wakes the controller.
 */
export function resumeQualificationInSession(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  connection: unknown,
  epoch: number,
): void {
  const state = get();
  if (refs.connection !== connection || state.controllerSessionEpoch !== epoch) return;
  const qualification = state.controllerQualification;
  if (qualification.kind !== 'qualifying' || qualification.epoch !== epoch) return;
  set({ controllerQualification: qualifyingController(epoch, 'reset-cleanup') });
  scheduleControllerQualification(set, get, refs, epoch);
}

/** How long a queued-poll controller may stay silent after connecting. */
export const POLLED_RESPONSE_TIMEOUT_MS = 8_000;

/**
 * A driver with no realtime status query (Marlin) sends nothing during the
 * handshake's active window, so its silence proves nothing: a board that does
 * not reboot on open, such as native-USB 32-bit Marlin, prints no banner, and
 * every connect used to end in "No controller response … check the cable"
 * while the first M114 poll moments later answered normally (controller audit
 * connect-5). The ordinary status poll starts when the handshake returns and
 * its first fresh Idle runs qualification. `onSilent` reports a controller
 * that never answers a poll; a late banner re-schedules qualification itself.
 */
export function awaitPolledQualification(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  connection: unknown,
  epoch: number,
  onSilent: () => void,
): void {
  if (refs.connection !== connection || get().controllerSessionEpoch !== epoch) return;
  set({ controllerQualification: qualifyingController(epoch, 'controller-response') });
  scheduleControllerQualification(set, get, refs, epoch);
  setTimeout(() => {
    const state = get();
    if (refs.connection !== connection || state.controllerSessionEpoch !== epoch) return;
    if (state.statusObservation?.sessionEpoch === epoch) return;
    const qualification = state.controllerQualification;
    if (qualification.kind !== 'qualifying' || qualification.epoch !== epoch) return;
    cancelScheduledControllerQualification(refs);
    onSilent();
  }, POLLED_RESPONSE_TIMEOUT_MS);
}

// A fresh Alarm or Sleep report is a controller answering and waiting for the
// operator ($X, $H or Wake), not a dead link. After a Stop mid-motion GRBL
// reboots into ALARM:3, and the 8 s deadline used to latch "Controller
// qualification failed" on every such Stop, with nothing re-arming it once the
// operator unlocked (audit connect-3). Qualification now runs on the first
// fresh Idle however long the operator takes; reports that stop arriving
// still time out.
function waitingOnOperator(state: LaserState): boolean {
  const reported = state.statusReport?.state;
  if (reported !== 'Alarm' && reported !== 'Sleep') return false;
  const observedAt = state.statusObservation?.observedAt;
  return observedAt !== undefined && Date.now() - observedAt <= QUALIFICATION_READY_TIMEOUT_MS;
}

function qualificationScheduleIsCurrent(
  state: LaserState,
  refs: ControllerQualificationScheduleRefs,
  epoch: number,
): boolean {
  return (
    refs.connection != null &&
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === epoch &&
    state.controllerQualification.epoch === epoch
  );
}

function qualificationIsTerminal(qualification: ControllerQualification): boolean {
  return qualification.kind === 'qualified' || qualification.kind === 'failed';
}

function controllerQualificationIsBusy(state: LaserState): boolean {
  return (
    state.controllerOperation !== null ||
    state.motionOperation !== null ||
    state.pendingUntrackedAcks > 0 ||
    pendingTransportWriteCount(state) > 0 ||
    isActiveJob(state.streamer)
  );
}

export function cancelScheduledControllerQualification(
  refs: ControllerQualificationScheduleRefs,
): void {
  if (refs.qualificationTimer != null) clearTimeout(refs.qualificationTimer);
  refs.qualificationTimer = null;
  refs.qualificationDeadline = null;
}
