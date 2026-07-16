// Coolant command emission for the CNC GRBL strategy. Coolant is machine-wide
// for the job: on right after spindle spin-up, off after the postamble M5.
// cnc-grbl-strategy.ts owns that ordering; this module only knows the
// M7/M8/M9 mapping.

import { assertNever, type CncCoolantMode } from '../scene';

// Emit the coolant-on command for the machine's mode and report whether one was
// emitted (so the postamble knows to close it with M9). 'off'/absent emits
// nothing and returns false — byte-identical to a job with no coolant.
export function appendCoolantStart(lines: string[], mode: CncCoolantMode | undefined): boolean {
  const command = cncCoolantOnCommand(mode);
  if (command === null) return false;
  lines.push(command);
  return true;
}

// Coolant-on command for the machine's mode: mist runs the mist-coolant
// relay (M7), flood the flood-coolant relay (M8). 'off'/absent ⇒ null.
function cncCoolantOnCommand(mode: CncCoolantMode | undefined): 'M7' | 'M8' | null {
  switch (mode) {
    case 'mist':
      return 'M7';
    case 'flood':
      return 'M8';
    case 'off':
    case undefined:
      return null;
    default:
      return assertNever(mode, 'CncCoolantMode');
  }
}
