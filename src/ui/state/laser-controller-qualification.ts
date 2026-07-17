import type { MachineKind } from '../../core/scene';
import type { LaserState } from './laser-store';
import { isActiveJob } from './laser-store-helpers';

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

// Ordinary laser output can already surface absent $30/$32 evidence in Job
// Review and require the existing unverified-laser-mode acknowledgement. Do
// not turn the background settings read into a duplicate dead-button gate.
// CNC keeps the strict qualification contract because spindle mode/scale and
// recovery setup are not safely inferred from the project profile.
export function normalStartQualificationBlockMessage(
  machineKind: MachineKind,
  qualification: ControllerQualification,
  currentEpoch: number,
): string | null {
  return machineKind === 'laser'
    ? null
    : controllerQualificationStartBlockMessage(qualification, currentEpoch);
}

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
    if (controllerBusy) refs.qualificationDeadline = Date.now() + QUALIFICATION_READY_TIMEOUT_MS;
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
    (state.pendingTransportWrites ?? 0) > 0 ||
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
