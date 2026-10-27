import type { ControllerCapabilities } from '../../core/controllers/controller-capabilities';
import type { LaserState } from './laser-store';
import { QualificationWait } from './laser-controller-qualification-wait';
import { machineSettingsReadBlockReason } from './machine-settings-read-readiness';
import { publishControllerIncident } from './laser-incident-publish';
import type { TranscriptBufferRefs } from './laser-transcript-buffer';
import type { JobTransportLedgerRefs } from './laser-job-transport-ledger';

export type ControllerQualificationPhase =
  | 'controller-response'
  | 'reset-cleanup'
  // Communication is proven in this session, with no reset behind it, but the
  // controller is in a state that takes no settings read yet (Sleep, Hold, a
  // jog still running, or Alarm on a controller without `$$`) (ADR-673).
  | 'awaiting-ready'
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

export type ControllerQualificationScheduleRefs = TranscriptBufferRefs &
  JobTransportLedgerRefs & {
    nextTranscriptId?: number;
    readonly connection?: unknown | null;
    readonly pendingResetCleanup?: unknown | null;
    readonly controllerCommand?: unknown | null;
    readonly settingsCollector?: { readonly kind: string };
    readonly driver?: { readonly commands: { readonly settingsQuery: string | null } };
    qualificationTimer?: ReturnType<typeof setTimeout> | null;
    qualificationDeadline?: number | null;
    qualificationRevision?: number;
    runControllerQualification?: (() => Promise<void>) | null;
    /** The scheduler's preferred run: it reads only `$G` (and `$I` if needed)
     * while this session still holds the `$$` read an owned reset kept, and
     * the full read otherwise (ADR-648). Decided when it runs, so every
     * reschedule of the same session keeps it. */
    runModalStateQualification?: (() => Promise<void>) | null;
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

type QualificationScheduleOptions = {
  /** Run only on an Idle that follows an Alarm report. */
  readonly afterAlarm?: boolean;
  /** Preserve connect-time diagnostics while continuing to listen for recovery. */
  readonly onSilent?: () => void;
};

type QualificationReadiness = {
  alarmSeen: boolean;
  /** This schedule saw the current Alarm report arrive (ADR-673). */
  freshAlarm: boolean;
  /** Settings may be read on that Alarm: the driver has a `$$` dump, which
   *  GRBL-family firmware answers in Alarm, and no halting reset
   *  (Smoothieware) waits for the Idle after its Alarm. */
  readonly readsInAlarm: boolean;
};

export function scheduleControllerQualification(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  epoch: number,
  options: QualificationScheduleOptions = {},
): void {
  cancelScheduledControllerQualification(refs);
  const connection = refs.connection;
  const revision = refs.qualificationRevision ?? 0;
  const readiness: QualificationReadiness = {
    alarmSeen: options.afterAlarm !== true,
    freshAlarm: false,
    readsInAlarm: options.afterAlarm !== true && refs.driver?.commands.settingsQuery != null,
  };
  let lastStatusSequence = get().statusSequence;
  // Only this scheduler's readiness failure can resume automatically. Empty
  // or rejected settings responses remain an explicit Retry.
  let readinessFailure: ControllerQualification | null = null;
  const wait = new QualificationWait(QUALIFICATION_READY_TIMEOUT_MS, refs);
  const poll = (): void => {
    refs.qualificationTimer = null;
    const state = get();
    if (!qualificationScheduleIsCurrent(state, refs, epoch, connection, revision)) {
      refs.qualificationDeadline = null;
      return;
    }
    if (qualificationScheduleHasEnded(state.controllerQualification, readinessFailure)) {
      refs.qualificationDeadline = null;
      return;
    }
    const receivedStatus = receivedControllerStatus(state, lastStatusSequence);
    lastStatusSequence = state.statusSequence;
    const timeout = wait.observe(state, refs, receivedStatus, options.onSilent);
    if (receivedStatus) readiness.freshAlarm = state.statusReport?.state === 'Alarm';
    const ready = qualificationReadinessAllowsRead(state, refs, readiness);
    if (readinessFailure !== null && wait.shouldRestore(state, receivedStatus)) {
      restoreQualificationAfterStatus(set, readinessFailure, epoch, readiness.alarmSeen);
      readinessFailure = null;
      wait.restored();
      if (!qualificationScheduleIsCurrent(get(), refs, epoch, connection, revision)) return;
    }
    if (!timeout.busy && ready) {
      refs.qualificationDeadline = null;
      startQualificationRun(refs);
      return;
    }
    readinessFailure = reportQualificationReadinessTimeout(
      set,
      get,
      refs,
      epoch,
      timeout.deadline,
      readinessFailure,
      timeout.onSilent,
      timeout.message,
    );
    wait.recordTimeout(readinessFailure !== null, timeout);
    if (!qualificationScheduleIsCurrent(get(), refs, epoch, connection, revision)) return;
    refs.qualificationTimer = setTimeout(poll, QUALIFICATION_READY_POLL_MS);
  };
  refs.qualificationTimer = setTimeout(poll, QUALIFICATION_READY_POLL_MS);
}

/**
 * A soft reset that halts the firmware instead of rebooting it (Smoothieware)
 * prints no banner, so no banner re-arms qualification (controller audit
 * 2026-09-25 CG-3). The halted board reports Alarm until the operator clears
 * it with M999. Qualification runs on the first fresh Idle after that Alarm,
 * so a report printed before the reset landed cannot start it.
 */
export function requalifyAfterHaltingReset(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  capabilities: Pick<ControllerCapabilities, 'softResetReboots'>,
): void {
  if (capabilities.softResetReboots !== false) return;
  scheduleControllerQualification(set, get, refs, get().controllerSessionEpoch, {
    afterAlarm: true,
  });
}

/**
 * An Alarm or Sleep status during the connect handshake moves the write epoch
 * but not the session epoch (no reboot). The handshake cannot tell that from a
 * stale await, so it returned silently and left qualification at "Waiting for
 * controller response…" forever when a board that does not reset on open was
 * locked in Alarm or Sleep (audit connect-2). The same connection and session,
 * with qualification still pending for it, is an in-session invalidation: the
 * scheduler runs qualification on the next fresh Alarm report of a controller
 * with a `$$` dump, which answers settings reads there, or else on the first
 * fresh Idle once the operator unlocks, homes or wakes the controller. Nothing
 * reset, so the phase says it waits for the controller (ADR-673).
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
  set({ controllerQualification: qualifyingController(epoch, 'awaiting-ready') });
  scheduleControllerQualification(set, get, refs, epoch);
}

/** How long a controller may stay silent once the status poll has started. */
export const POLLED_RESPONSE_TIMEOUT_MS = 8_000;

/**
 * A driver with no realtime status query (Marlin) sends nothing during the
 * handshake's active window, so its silence proves nothing: a board that does
 * not reboot on open, such as native-USB 32-bit Marlin, prints no banner, and
 * every connect used to end in "No controller response … check the cable"
 * while the first M114 poll moments later answered normally (controller audit
 * connect-5). A GRBL-family board silent through that window may still be
 * starting up (controller audit T-4, ADR-375). The ordinary status poll starts
 * when the handshake returns and its first fresh Idle runs qualification.
 * `onSilent` reports a controller that never answers a poll; a late banner
 * re-schedules qualification itself.
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
  scheduleControllerQualification(set, get, refs, epoch, { onSilent });
}

function qualificationScheduleHasEnded(
  qualification: ControllerQualification,
  readinessFailure: ControllerQualification | null,
): boolean {
  return (
    qualification.kind === 'qualified' ||
    (qualification.kind === 'failed' && qualification !== readinessFailure)
  );
}

function receivedControllerStatus(state: LaserState, previousSequence: number): boolean {
  return state.statusSequence !== previousSequence && state.statusReport !== null;
}

function qualificationReadinessAllowsRead(
  state: LaserState,
  refs: ControllerQualificationScheduleRefs,
  readiness: QualificationReadiness,
): boolean {
  if (state.statusReport?.state === 'Alarm') readiness.alarmSeen = true;
  return (
    readiness.alarmSeen &&
    machineSettingsReadBlockReason(state, {
      resetCleanupPending: refs.pendingResetCleanup != null,
      settingsCollectionActive: refs.settingsCollector?.kind === 'collecting',
      requireCurrentStatusObservation: true,
      freshAlarmObserved: readiness.readsInAlarm && readiness.freshAlarm,
    }) === null
  );
}

function restoreQualificationAfterStatus(
  set: SetFn,
  readinessFailure: ControllerQualification,
  epoch: number,
  alarmSeen: boolean,
): void {
  set((current) =>
    current.controllerQualification === readinessFailure
      ? {
          controllerQualification: qualifyingController(
            epoch,
            alarmSeen ? 'controller-response' : 'reset-cleanup',
          ),
        }
      : {},
  );
}

function reportQualificationReadinessTimeout(
  set: SetFn,
  get: GetFn,
  refs: ControllerQualificationScheduleRefs,
  epoch: number,
  deadline: number | null | undefined,
  readinessFailure: ControllerQualification | null,
  onSilent: (() => void) | undefined,
  message = 'Waiting for a fresh controller status. Controller information will refresh automatically when the connection responds and reports Idle.',
): ControllerQualification | null {
  if (readinessFailure !== null || Date.now() < (deadline ?? 0)) return readinessFailure;
  if (onSilent !== undefined) {
    onSilent();
    const qualification = get().controllerQualification;
    return qualification.kind === 'failed' && qualification.epoch === epoch ? qualification : null;
  }
  let failure: ControllerQualification | null = null;
  set((state) => {
    const patch = failedControllerQualificationPatch(state, epoch, message);
    failure = patch.controllerQualification ?? null;
    return failure === null
      ? {}
      : {
          ...publishControllerIncident(
            refs,
            state,
            '[lf2] Controller information refresh timed out: ' + message,
          ),
          ...patch,
        };
  });
  return failure;
}

function qualificationScheduleIsCurrent(
  state: LaserState,
  refs: ControllerQualificationScheduleRefs,
  epoch: number,
  connection: unknown,
  revision: number,
): boolean {
  return (
    refs.connection != null &&
    refs.connection === connection &&
    (refs.qualificationRevision ?? 0) === revision &&
    state.connection.kind === 'connected' &&
    state.controllerSessionEpoch === epoch &&
    state.controllerQualification.epoch === epoch
  );
}

function startQualificationRun(refs: ControllerQualificationScheduleRefs): void {
  const run = refs.runModalStateQualification ?? refs.runControllerQualification;
  if (run != null) void run().catch(() => undefined);
}

export function cancelScheduledControllerQualification(
  refs: ControllerQualificationScheduleRefs,
): void {
  if (refs.qualificationTimer != null) clearTimeout(refs.qualificationTimer);
  refs.qualificationRevision = (refs.qualificationRevision ?? 0) + 1;
  refs.qualificationTimer = null;
  refs.qualificationDeadline = null;
}
