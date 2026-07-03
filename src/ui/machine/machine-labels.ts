// machine-labels — machine-kind-aware display strings for chrome shared by
// laser and CNC modes (ADR-101 §7). Only user-visible copy changes with the
// machine kind; internal keys (the 'laser' command family, store names, file
// names) deliberately do not rename.

import type { MachineKind } from '../../core/scene';

// Lower-case noun for mid-sentence copy ("connect to your laser controller").
export function machineNoun(kind: MachineKind): string {
  return kind === 'cnc' ? 'router' : 'laser';
}

// Right-rail heading and the menu family label.
export function machineDisplayName(kind: MachineKind): string {
  return kind === 'cnc' ? 'Router' : 'Laser';
}

export function machineControlsLabel(kind: MachineKind): string {
  return kind === 'cnc' ? 'Router controls' : 'Laser controls';
}

// "burn" is laser jargon; a router cuts.
export function jobTimeNoun(kind: MachineKind): string {
  return kind === 'cnc' ? 'cut' : 'burn';
}
