export type LaserControllerOperation =
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
      readonly phase: 'sequence' | 'settling' | 'awaiting-idle';
      readonly idleReports: number;
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
    };

export const CONTROLLER_OPERATION_ACTIVE_MESSAGE =
  'A controller operation is active. Wait for it to finish before sending another command.';

export function controllerOperationCommandBlockMessage(
  operation: LaserControllerOperation | null,
): string | null {
  return operation === null ? null : CONTROLLER_OPERATION_ACTIVE_MESSAGE;
}

export function describeControllerOperation(operation: LaserControllerOperation | null): string {
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
    if (operation.phase === 'sequence') return 'Probing';
    if (operation.phase === 'settling') return 'Settling after probe';
    return 'Waiting for fresh Idle after probe';
  }
  if (operation.kind === 'recovery') {
    return operation.phase === 'reset' ? 'Recovering controller' : 'Waiting for Idle after reset';
  }
  if (operation.kind === 'start-arming') {
    return describeStartArming(operation.phase);
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
