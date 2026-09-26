import type { MachineKind } from '../../core/scene';

export function machineCapabilityWarningMessage(requestedKind: MachineKind): string {
  return requestedKind === 'cnc'
    ? 'CNC mode is active, but this profile declares Laser only. Confirm the installed spindle, powered Z, and CNC settings in Machine Setup. The capability label is a warning, not a mode gate.'
    : 'Laser mode is active, but this profile declares CNC only. Confirm the installed laser head and laser settings in Machine Setup. The capability label is a warning, not a mode gate.';
}

/** CNC mode on a profile whose controller cannot run KerfDesk CNC jobs
 *  (`capabilities.cncJobs` false: Marlin, Smoothieware, Ruida). A warning,
 *  not a mode gate (controller audit 2026-09-25 CN-2, ADR-399). */
export function cncControllerWarningMessage(controllerLabel: string): string {
  return `CNC mode is active, but this profile's controller (${controllerLabel}) cannot run KerfDesk CNC jobs: they need a GRBL-family controller (GRBL, grblHAL, FluidNC). Choose a GRBL-family machine profile for router work, or switch back to Laser mode.`;
}

export function loadedMachineCapabilityWarningMessage(activeKind: MachineKind): string {
  const mode = activeKind === 'cnc' ? 'CNC' : 'Laser';
  return `This project remains in ${mode} mode even though its saved capability label does not include that mode. Review Machine Setup; no machine mode or saved settings were silently rewritten.`;
}
