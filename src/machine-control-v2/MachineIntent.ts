export type Axis = 'X' | 'Y' | 'Z' | 'A';

export type MachineIntent =
  | { kind: 'connect'; targetId: string }
  | { kind: 'disconnect' }
  | { kind: 'startJob'; ticketId: string }
  | { kind: 'pauseJob' }
  | { kind: 'resumeJob' }
  | { kind: 'stopJob'; reason?: string }
  | { kind: 'emergencyStop' }
  | { kind: 'jog'; axis: Axis; distanceMm: number; feedMmPerMin: number }
  | { kind: 'cancelJog' }
  | { kind: 'frame'; ticketId: string }
  | { kind: 'testFire'; powerPercent: number; durationMs: number }
  | { kind: 'unlockAlarm' }
  | { kind: 'home'; axes?: readonly Axis[] }
  | { kind: 'resetWcsToBaseline'; axes: readonly Axis[] }
  | { kind: 'manualCommand'; line: string };

export type OperationTrust = 'trusted' | 'untrusted' | 'unknown';

export interface MachineOperationResult {
  readonly accepted: boolean;
  readonly intent: MachineIntent['kind'];
  readonly emittedCommands: readonly string[];
  readonly reason?: string;
  readonly positionTrust: OperationTrust;
  readonly laserOutputTrust: OperationTrust;
  readonly requiresRehome: boolean | 'unknown';
}

export function assertMachineIntent(intent: MachineIntent): void {
  if (!intent || typeof intent.kind !== 'string') {
    throw new Error('Invalid machine intent.');
  }
}

export function machineIntentRequiresExclusiveOperation(intent: MachineIntent): boolean {
  switch (intent.kind) {
    case 'pauseJob':
    case 'resumeJob':
    case 'stopJob':
    case 'emergencyStop':
    case 'cancelJog':
      return false;
    default:
      return true;
  }
}
