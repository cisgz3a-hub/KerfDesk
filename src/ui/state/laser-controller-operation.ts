import type { FramedRunPermit } from './framed-run';

export type LaserControllerOperation =
  | {
      readonly kind: 'connection-handshake';
      readonly phase: 'waiting-controller' | 'settings';
    }
  | {
      readonly kind: 'home';
      readonly phase: 'command' | 'settling' | 'awaiting-idle';
      readonly idleReports: number;
    }
  | {
      readonly kind: 'post-job-settle';
      readonly phase: 'dwell' | 'awaiting-idle';
      readonly idleReports: number;
    }
  | {
      readonly kind: 'probe';
      readonly phase: 'sequence' | 'settling' | 'awaiting-idle' | 'recovering';
      readonly idleReports: number;
      readonly transactionId: number;
      readonly affectsXy: boolean;
    }
  | {
      readonly kind: 'interactive-command';
      readonly phase: 'command';
      readonly label: string;
    }
  | {
      readonly kind: 'recovery';
      readonly phase: 'reset' | 'awaiting-idle';
      readonly idleReports: number;
    }
  | {
      readonly kind: 'start-arming';
      readonly phase: 'queue-fence' | 'live-status';
      /** One exact Run report accepted while the tagged CNC queue-fence dwell
       * owned the controller. The stamp survives ordinary state updates only
       * for this status sequence and this permit object. */
      readonly ownedRunStatusSequence?: number;
      readonly ownedRunPermit?: FramedRunPermit;
    }
  | {
      readonly kind: 'work-z-recovery';
      readonly phase: 'modal-state' | 'offsets';
    };

export const CONTROLLER_OPERATION_ACTIVE_MESSAGE =
  'A controller operation is active. Wait for it to finish before sending another command.';

export function controllerOperationCommandBlockMessage(
  operation: LaserControllerOperation | null,
): string | null {
  return operation === null ? null : CONTROLLER_OPERATION_ACTIVE_MESSAGE;
}

export function isUnsafeControllerOperation(operation: LaserControllerOperation | null): boolean {
  return operation !== null && operation.kind !== 'connection-handshake';
}

export function describeControllerOperation(operation: LaserControllerOperation | null): string {
  if (operation?.kind === 'connection-handshake') {
    return describeConnectionHandshake(operation.phase);
  }
  return describeEstablishedControllerOperation(operation);
}

function describeConnectionHandshake(phase: 'waiting-controller' | 'settings'): string {
  return phase === 'waiting-controller'
    ? 'Waiting for controller response'
    : 'Reading controller settings';
}

function describeEstablishedControllerOperation(
  operation: Exclude<LaserControllerOperation, { readonly kind: 'connection-handshake' }> | null,
): string {
  if (operation === null) return 'Controller ready';
  if (operation.kind === 'home') {
    if (operation.phase === 'command') return 'Homing';
    if (operation.phase === 'settling') return 'Settling after Home';
    return 'Waiting for fresh Idle after Home';
  }
  if (operation.kind === 'post-job-settle') {
    return describePostJobSettle(operation.phase);
  }
  if (operation.kind === 'probe') {
    return describeProbeOperation(operation.phase);
  }
  if (operation.kind === 'recovery') {
    return operation.phase === 'reset' ? 'Recovering controller' : 'Waiting for Idle after reset';
  }
  if (operation.kind === 'start-arming') {
    return describeStartArming(operation.phase);
  }
  if (operation.kind === 'work-z-recovery') {
    return operation.phase === 'modal-state'
      ? 'Reading active CNC work coordinates'
      : 'Reading CNC work offsets';
  }
  return operation.label;
}

function describePostJobSettle(phase: 'dwell' | 'awaiting-idle'): string {
  return phase === 'dwell' ? 'Settling after job' : 'Waiting for stable Idle after job';
}

function describeStartArming(phase: 'queue-fence' | 'live-status'): string {
  return phase === 'queue-fence'
    ? 'Fencing controller queue before Start'
    : 'Verifying live controller state before Start';
}

function describeProbeOperation(
  phase: Extract<LaserControllerOperation, { kind: 'probe' }>['phase'],
): string {
  if (phase === 'sequence') return 'Probing';
  if (phase === 'settling') return 'Settling after probe';
  if (phase === 'awaiting-idle') return 'Waiting for fresh Idle after probe';
  return 'Recovering after an uncertain probe';
}
