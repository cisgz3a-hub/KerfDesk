import type { ControllerQualificationScheduleRefs } from './laser-controller-qualification';
import { controllerInformationActivityIsBusy } from './controller-information-activity';
import { hasPendingControllerWrite, pendingTransportWriteCount } from './laser-start-queue-fence';
import type { LaserState } from './laser-store';

export type QualificationOwnershipWait = {
  ackDeadline: number | null;
  writeDeadline: number | null;
  acks: number;
  writes: number;
};

type QualificationWaitTimeout = {
  readonly busy: boolean;
  readonly deadline: number | null | undefined;
  readonly onSilent: (() => void) | undefined;
  readonly message: string | undefined;
  readonly ownershipDiagnostic: boolean;
};

/** Keep communication and each response-ownership clock independent. */
export class QualificationWait {
  private readonly ownership: QualificationOwnershipWait = {
    ackDeadline: null,
    writeDeadline: null,
    acks: 0,
    writes: 0,
  };
  private responseDeadline: number;
  private ownershipFailure = false;
  private sawStatus = false;

  constructor(
    private readonly timeoutMs: number,
    refs: ControllerQualificationScheduleRefs,
  ) {
    this.responseDeadline = Date.now() + timeoutMs;
    refs.qualificationDeadline = this.responseDeadline;
  }

  observe(
    state: LaserState,
    refs: ControllerQualificationScheduleRefs,
    receivedStatus: boolean,
    onSilent: (() => void) | undefined,
  ): QualificationWaitTimeout {
    const activityBusy = controllerQualificationActivityIsBusy(state, refs);
    const pendingWrite = hasPendingControllerWrite(state);
    const ownershipDeadline = qualificationOwnershipDeadline(
      state,
      activityBusy,
      this.ownership,
      this.timeoutMs,
    );
    const ownershipTimedOut = Date.now() >= (ownershipDeadline ?? Infinity);
    // Alarm/Sleep replies prove communication without proving position. An
    // active operation keeps its busy allowance; bare reply debt does not.
    if (activityBusy || receivedStatus) refs.qualificationDeadline = Date.now() + this.timeoutMs;
    if (receivedStatus) {
      this.sawStatus = true;
      this.responseDeadline = Date.now() + this.timeoutMs;
    }
    // Connect's queued startup poll may owe an ACK while totally silent.
    // Keep its silence diagnostic until a fresh status proves communication.
    const responseDeadline =
      onSilent === undefined ? refs.qualificationDeadline : this.responseDeadline;
    const ownershipDiagnostic =
      !activityBusy &&
      canDiagnosePendingOwnership(pendingWrite, onSilent, this.sawStatus) &&
      (ownershipTimedOut || Date.now() >= (responseDeadline ?? Infinity));
    return {
      busy: activityBusy || pendingWrite,
      deadline: ownershipTimedOut ? ownershipDeadline : responseDeadline,
      ...qualificationFailureOptions(state, ownershipDiagnostic, onSilent),
      ownershipDiagnostic,
    };
  }

  shouldRestore(state: LaserState, receivedStatus: boolean): boolean {
    return this.ownershipFailure ? !hasPendingControllerWrite(state) : receivedStatus;
  }

  recordTimeout(failed: boolean, timeout: QualificationWaitTimeout): void {
    this.ownershipFailure ||= failed && timeout.ownershipDiagnostic;
  }

  restored(): void {
    this.ownershipFailure = false;
  }
}

function canDiagnosePendingOwnership(
  pendingWrite: boolean,
  onSilent: (() => void) | undefined,
  sawStatus: boolean,
): boolean {
  return pendingWrite && (onSilent === undefined || sawStatus);
}

function qualificationFailureOptions(
  state: LaserState,
  ownershipDiagnostic: boolean,
  onSilent: (() => void) | undefined,
): Pick<QualificationWaitTimeout, 'onSilent' | 'message'> {
  return {
    onSilent: ownershipDiagnostic ? undefined : onSilent,
    message: ownershipDiagnostic ? qualificationOwnershipTimeoutMessage(state) : undefined,
  };
}

function qualificationOwnershipTimeoutMessage(state: LaserState): string {
  const blockers: string[] = [];
  if (pendingTransportWriteCount(state) > 0) {
    blockers.push('Controller writes are still in transport.');
  }
  if (state.pendingUntrackedAcks > 0) {
    blockers.push('Earlier controller writes have unresolved acknowledgement reservations.');
  }
  return (
    `${blockers.join(' ')} Controller information cannot refresh yet. ` +
    'Reconnect to recover it, or wait for these writes or replies to settle or for a controller reboot.'
  );
}

/** Real operations retain their existing busy allowance. A terminal stream's
 * reply ledger freezes refill but is no longer a running operation. */
export function controllerQualificationActivityIsBusy(
  state: LaserState,
  refs: ControllerQualificationScheduleRefs,
): boolean {
  return (
    refs.pendingResetCleanup != null ||
    refs.controllerCommand != null ||
    refs.settingsCollector?.kind === 'collecting' ||
    controllerInformationActivityIsBusy(state)
  );
}

/** Idle/status replies prove communication, never the missing terminal ACK.
 * Bound orphaned write/reply ownership separately, without clearing its debt.
 * Actual ledger progress earns another bounded window; a new status does not. */
export function qualificationOwnershipDeadline(
  state: LaserState,
  activityBusy: boolean,
  wait: QualificationOwnershipWait,
  timeoutMs: number,
): number | null {
  const acks = state.pendingUntrackedAcks;
  const writes = pendingTransportWriteCount(state);
  wait.ackDeadline = nextOwnershipDeadline(
    acks,
    wait.acks,
    wait.ackDeadline,
    activityBusy,
    timeoutMs,
  );
  wait.writeDeadline = nextOwnershipDeadline(
    writes,
    wait.writes,
    wait.writeDeadline,
    activityBusy,
    timeoutMs,
  );
  wait.acks = acks;
  wait.writes = writes;
  const deadline = Math.min(wait.ackDeadline ?? Infinity, wait.writeDeadline ?? Infinity);
  return deadline === Infinity ? null : deadline;
}

function nextOwnershipDeadline(
  pending: number,
  previous: number,
  deadline: number | null,
  activityBusy: boolean,
  timeoutMs: number,
): number | null {
  if (activityBusy || pending === 0) return null;
  return deadline === null || pending < previous ? Date.now() + timeoutMs : deadline;
}
