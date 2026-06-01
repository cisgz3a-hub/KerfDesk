import type { GcodeStartMode } from '../core/output/GcodeOrigin';
import type { MachineStatus } from '../controllers/ControllerInterface';
import type { SafetyState } from './SafetyStateMachine';

export type StartBlockerSeverity = 'hardBlock' | 'recoverableBlock' | 'warning';

export interface StartBlocker {
  readonly id:
    | 'not-connected'
    | 'machine-state'
    | 'controller-error'
    | 'active-operation'
    | 'laser-output'
    | 'safety-state'
    | 'position-unknown'
    | 'wcs-unverified'
    | 'current-position-unconfirmed';
  readonly severity: StartBlockerSeverity;
  readonly title: string;
  readonly message: string;
  readonly action: string;
}

export interface StartBlockerInput {
  readonly isConnected: boolean;
  readonly machineStatus: MachineStatus | null | undefined;
  readonly machineErrorCode: number | null | undefined;
  readonly laserOutputState: 'off' | 'on' | 'unknown';
  readonly activeOperation: { readonly kind: string } | null;
  readonly safetyState: SafetyState;
  readonly placementUncertain: boolean;
  readonly placementUncertainReason?: string | null;
  readonly allowUnverifiedWcsStart: boolean;
  readonly startMode: GcodeStartMode;
  readonly currentPositionConfirmed?: boolean;
}

export class StartBlockedError extends Error {
  readonly blocker: StartBlocker;

  constructor(blocker: StartBlocker) {
    super(formatStartBlockerForError(blocker));
    this.name = 'StartBlockedError';
    this.blocker = blocker;
  }
}

function safetyStateBlocker(state: SafetyState): StartBlocker | null {
  switch (state.kind) {
    case 'safeIdle':
      return null;
    case 'stoppedPositionUnknown':
      return {
        id: 'position-unknown',
        severity: 'recoverableBlock',
        title: 'Position needs confirmation after stop/reset',
        message: state.reason,
        action: 'Inspect the machine, manually verify zero or Set Origin, then Frame again before Start.',
      };
    case 'requiresInspection':
      return {
        id: 'safety-state',
        severity: 'hardBlock',
        title: 'Inspection required before Start',
        message: state.reason,
        action: 'Inspect the machine and complete the recovery steps before starting.',
      };
    case 'laserOffCommandedUnknown':
      return {
        id: 'safety-state',
        severity: 'hardBlock',
        title: 'Laser-off confirmation is pending',
        message: 'LaserForge sent a laser-off command but has not confirmed the laser is off.',
        action: 'Wait for confirmation, click Stop, or reconnect before starting.',
      };
    case 'unsafeUnknown':
      return {
        id: 'safety-state',
        severity: 'hardBlock',
        title: 'Machine safety state is unknown',
        message: state.reason,
        action: 'Reconnect or complete the required recovery before starting.',
      };
    default:
      return {
        id: 'safety-state',
        severity: 'hardBlock',
        title: 'Machine is busy',
        message: `Safety state is ${state.kind}.`,
        action: 'Wait for the current action to finish or stop the machine before starting.',
      };
  }
}

export function evaluateStartBlockers(input: StartBlockerInput): StartBlocker[] {
  const blockers: StartBlocker[] = [];

  if (!input.isConnected) {
    blockers.push({
      id: 'not-connected',
      severity: 'hardBlock',
      title: 'No controller connection',
      message: 'LaserForge is not connected to a controller.',
      action: 'Connect to the machine before starting.',
    });
  }

  if (input.machineErrorCode != null) {
    blockers.push({
      id: 'controller-error',
      severity: 'hardBlock',
      title: `Controller error ${input.machineErrorCode}`,
      message: `The controller reported error ${input.machineErrorCode}.`,
      action: 'Read the controller log and clear the error before starting.',
    });
  }

  if (input.machineStatus != null && input.machineStatus !== 'idle') {
    blockers.push({
      id: 'machine-state',
      severity: 'hardBlock',
      title: `Machine is "${input.machineStatus}"`,
      message: `The live controller status is ${input.machineStatus}.`,
      action: 'Wait for idle, unlock/recover the controller, or stop the machine if it is still moving.',
    });
  }

  if (input.activeOperation != null) {
    blockers.push({
      id: 'active-operation',
      severity: 'hardBlock',
      title: `Operation "${input.activeOperation.kind}" is still in progress`,
      message: 'Another machine operation is active.',
      action: 'Wait for that operation to finish, or click Stop if it is stuck.',
    });
  }

  if (input.laserOutputState !== 'off') {
    blockers.push({
      id: 'laser-output',
      severity: 'hardBlock',
      title: input.laserOutputState === 'unknown'
        ? 'Laser-safety state unknown'
        : 'Laser output is still marked on',
      message: input.laserOutputState === 'unknown'
        ? 'LaserForge cannot prove the laser is off.'
        : 'LaserForge still believes the laser output is on.',
      action: input.laserOutputState === 'unknown'
        ? 'Reconnect or clear the laser safety state before starting.'
        : 'Release Test Fire or confirm laser off before starting.',
    });
  }

  const safetyBlocker = safetyStateBlocker(input.safetyState);
  if (safetyBlocker) blockers.push(safetyBlocker);

  if (input.placementUncertain) {
    const reason = input.placementUncertainReason ?? 'unknown';
    if (input.allowUnverifiedWcsStart && input.startMode === 'current') {
      blockers.push({
        id: 'wcs-unverified',
        severity: 'warning',
        title: 'Work-coordinate state not verified',
        message: `This manual-zero profile can start current-head jobs without verified G54 state (reason: ${reason}).`,
        action: 'Use a fresh Frame and do not use saved-origin mode until Set Origin can verify G54.',
      });
    } else {
      blockers.push({
        id: 'wcs-unverified',
        severity: 'hardBlock',
        title: 'Work-coordinate state could not be confirmed',
        message: `The controller did not provide reliable WCS/G54 proof (reason: ${reason}).`,
        action: 'Reset WCS, reconnect, or use current-head mode on a manual-zero profile.',
      });
    }
  }

  if (input.startMode === 'current' && input.currentPositionConfirmed === false) {
    blockers.push({
      id: 'current-position-unconfirmed',
      severity: 'hardBlock',
      title: 'Current head position is not confirmed',
      message: 'Relative current-head output needs a reported controller position for bounds checking.',
      action: 'Reconnect to refresh MPos/WPos, then Frame again before starting.',
    });
  }

  return blockers;
}

export function firstStartBlocker(blockers: readonly StartBlocker[]): StartBlocker | null {
  return blockers.find((b) => b.severity === 'hardBlock' || b.severity === 'recoverableBlock') ?? null;
}

export function formatStartBlockerForError(blocker: StartBlocker): string {
  return `${blocker.title}: ${blocker.message} ${blocker.action}`;
}

export function makeStartBlockedError(blocker: StartBlocker): StartBlockedError {
  return new StartBlockedError(blocker);
}

export function isStartBlockedError(err: unknown): err is StartBlockedError {
  return err instanceof StartBlockedError;
}

export function isPreStartStartBlocker(err: unknown): boolean {
  if (isStartBlockedError(err)) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    /Cannot start job/i.test(msg) ||
    /Position needs confirmation/i.test(msg) ||
    /current head position is unknown/i.test(msg) ||
    /Cannot accept relative-mode job/i.test(msg)
  );
}
