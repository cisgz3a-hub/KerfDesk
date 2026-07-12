import type { MachineKind } from '../../core/scene';

export function resumeConfirmation(
  machineKind: MachineKind,
  requestedLine: number,
  recoveryLine: number,
): string {
  const details =
    machineKind === 'cnc'
      ? `The interruption was near line ${requestedLine}. Recovery rewinds to safe retract boundary line ${recoveryLine}, extracts Z at the recorded plunge feed before any spindle-start command, waits for full spin-up at safe height, then replays that complete cutting segment.`
      : `The machine will move to the recorded position with the beam off, then replay from line ${recoveryLine}.`;
  const label = machineKind === 'cnc' ? 'CNC recovery' : 'resume';
  return `Review ${label}:\n\n${details}\n\nThe work zero must be UNCHANGED since the original run. Continue?`;
}
