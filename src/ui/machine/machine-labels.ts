// machine-labels — machine-kind-aware display strings for chrome shared by
// laser and CNC modes (ADR-101 §7). Only user-visible copy changes with the
// machine kind; internal keys (the 'laser' command family, store names, file
// names) deliberately do not rename.

import type { MachineKind } from '../../core/scene';

// Mid-sentence noun ("connect to your laser controller"). CNC mode says
// "CNC", the name the Laser / CNC switch uses (ADR-101 amendment 2026-10-10).
export function machineNoun(kind: MachineKind): string {
  return kind === 'cnc' ? 'CNC' : 'laser';
}

// Right-rail heading and the menu family label.
export function machineDisplayName(kind: MachineKind): string {
  return kind === 'cnc' ? 'CNC' : 'Laser';
}

export function machineControlsLabel(kind: MachineKind): string {
  return kind === 'cnc' ? 'CNC controls' : 'Laser controls';
}

// "burn" is laser jargon; a router cuts.
export function jobTimeNoun(kind: MachineKind): string {
  return kind === 'cnc' ? 'cut' : 'burn';
}
