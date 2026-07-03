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
      readonly kind: 'interactive-command';
      readonly phase: 'command';
      readonly label: string;
    }
  | {
      readonly kind: 'recovery';
      readonly phase: 'reset' | 'awaiting-idle';
      readonly idleReports: number;
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
    if (operation.phase === 'dwell') return 'Settling after job';
    return 'Waiting for stable Idle after job';
  }
  if (operation.kind === 'recovery') {
    return operation.phase === 'reset' ? 'Recovering controller' : 'Waiting for Idle after reset';
  }
  return operation.label;
}
