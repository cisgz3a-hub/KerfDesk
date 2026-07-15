import type { MachineKind } from '../../core/scene';

export function blockedMachineModeMessage(requestedKind: MachineKind): string {
  return requestedKind === 'cnc'
    ? 'CNC mode is unavailable. This machine is set to Laser only. Open Machine Setup and choose CNC only or Laser + CNC.'
    : 'Laser mode is unavailable. This machine is set to CNC only. Open Machine Setup and choose Laser only or Laser + CNC.';
}

export function repairedMachineCapabilityMessage(
  activeKind: MachineKind,
  preservedCnc: boolean,
): string {
  const mode = activeKind === 'cnc' ? 'CNC' : 'Laser';
  const capability = activeKind === 'cnc' ? 'CNC only' : 'Laser only';
  const preserved = preservedCnc ? ' The previous CNC setup was preserved.' : '';
  return `This project was switched to ${mode} mode because its machine profile is set to ${capability}.${preserved} Open Machine Setup and choose Laser + CNC to enable both modes.`;
}
