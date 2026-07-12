// coolantFields — project the machine-level coolant mode onto a compiled
// CncGroup's optional `coolant` field.
//
// Coolant is a machine-wide job setting (a router's flood/mist is not
// per-operation), so every compiled group carries the same value; the emitter
// reads the first group's mode once. Absent or 'off' returns no field at all,
// keeping the group shape and emitted G-code byte-identical to pre-coolant
// jobs (the same discipline parkFields uses for H.9 park parity).

import type { CncGroup } from '../job';
import type { CncMachineConfig } from '../scene';

export function coolantFields(
  config: CncMachineConfig,
): Pick<CncGroup, 'coolant'> | Record<string, never> {
  const { coolant } = config.params;
  if (coolant === undefined || coolant === 'off') return {};
  return { coolant };
}
