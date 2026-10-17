// The visible name of each menu family, shared by the menu bar and the command
// search so a result's "Tools" or "Laser" tag reads exactly like the menu it
// lives in.

import type { MachineKind } from '../../core/scene';
import { machineDisplayName } from '../machine/machine-labels';
import type { CommandFamily } from './command-types';

export function commandFamilyLabel(family: CommandFamily, machineKind: MachineKind): string {
  switch (family) {
    case 'file':
      return 'File';
    case 'edit':
      return 'Edit';
    case 'tools':
      return 'Tools';
    case 'arrange':
      return 'Arrange';
    case 'laser':
      // The family KEY stays 'laser' (ADR-101 §7); only the visible label
      // follows the machine kind.
      return machineDisplayName(machineKind);
    case 'window':
      return 'Window';
    case 'help':
      return 'Help';
  }
}
