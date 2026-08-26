import type { MachineKind } from '../../core/scene';

export function machineCapabilityWarningMessage(requestedKind: MachineKind): string {
  return requestedKind === 'cnc'
    ? 'CNC mode is active, but this profile declares Laser only. Confirm the installed spindle, powered Z, and CNC settings in Machine Setup. The capability label is a warning, not a mode gate.'
    : 'Laser mode is active, but this profile declares CNC only. Confirm the installed laser head and laser settings in Machine Setup. The capability label is a warning, not a mode gate.';
}

export function loadedMachineCapabilityWarningMessage(activeKind: MachineKind): string {
  const mode = activeKind === 'cnc' ? 'CNC' : 'Laser';
  return `This project remains in ${mode} mode even though its saved capability label does not include that mode. Review Machine Setup; no machine mode or saved settings were silently rewritten.`;
}
