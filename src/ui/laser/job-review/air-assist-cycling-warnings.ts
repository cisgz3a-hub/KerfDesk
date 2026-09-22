// What the operator is told when air assist is held on across an Air-off
// operation (ADR-335).
//
// On a controller whose air assist cannot be restarted mid-program the emitter
// keeps the pump running through an Air-off operation that sits between two
// Air-on ones, because cycling it off and on again is the step that firmware
// fails to honour. That is a real departure from what the operations table
// says, so it is stated plainly here rather than left to be discovered in the
// G-code, together with the controller setting that removes the need for it.
//
// Advisory only (rule 7 / ADR-228). Nothing here refuses a Start: the operator
// can turn Air on for the bridged operation to make the emitted program match
// the table exactly, or clear the machine's restart flag once the controller
// is fixed.

import type { DeviceProfile } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { bridgedAirGapIndices } from '../../../core/output/air-assist-hold';
import type { Layer } from '../../../core/scene';
import { operationNames } from './operation-names';

type AirCyclingDevice = Pick<DeviceProfile, 'airAssistCommand' | 'airAssistRestartUnreliable'>;

export function detectAirAssistCyclingWarnings(
  job: Job,
  device: AirCyclingDevice,
  layers: ReadonlyArray<Layer> = [],
): ReadonlyArray<string> {
  if (device.airAssistCommand === 'none') return [];
  // A CNC group never carries air, and reads as Air-off for the gap rule.
  const wantsAir = job.groups.map((group) => group.kind !== 'cnc' && group.airAssist);
  const bridged = bridgedAirGapIndices(wantsAir, device.airAssistRestartUnreliable === true);
  if (bridged.size === 0) return [];
  const names = operationNames(layers);
  const held = [...bridged].map((index) => {
    const group = job.groups[index];
    const layerId = group === undefined ? '' : group.layerId;
    return names.get(layerId) ?? layerId;
  });
  return [
    `Air assist stays on through ${listOperations(held)} even though Air is off there. ` +
      'This controller does not reliably restart its pump inside a running job, so ' +
      'switching air off and back on would risk losing it for every operation after. ' +
      `Turn Air on for ${held.length === 1 ? 'that operation' : 'those operations'} to make ` +
      'the program match the table, or set $152=100 on the controller (the standby ' +
      'wait; 100 keeps the pump and laser module powered instead of idling them after ' +
      'the default 30 s) and untick "Air restart" in Machine Setup to get per-operation ' +
      'air back.',
  ];
}

function listOperations(names: ReadonlyArray<string>): string {
  if (names.length === 1) return `${names[0] ?? ''}`;
  const head = names.slice(0, -1).join(', ');
  return `${head} and ${names[names.length - 1] ?? ''}`;
}
