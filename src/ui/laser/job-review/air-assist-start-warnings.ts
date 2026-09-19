import type { DeviceProfile } from '../../../core/devices';
import type { Job } from '../../../core/job';
import { outputOperationLayers, type Layer } from '../../../core/scene';

// Job-controlled air (M7/M8) is written only immediately before the first
// operation whose Air setting is on (grbl-strategy's coolant transition), and a
// new operation defaults to Air off. Until that first command the pump is
// silent, so on wood the opening operation burns under its own smoke — the
// "dark shadows at the start of the job" report from the Falcon A1 Pro
// (ADR-323). These are advisories only (rule 7 / ADR-228): Job Review's Air
// column is the fix, in place, before Start.

type LaserGroup = Exclude<Job['groups'][number], { readonly kind: 'cnc' }>;

export function detectAirAssistStartWarnings(
  job: Job,
  device: Pick<DeviceProfile, 'airAssistCommand'>,
  layers: ReadonlyArray<Layer> = [],
): ReadonlyArray<string> {
  const command = device.airAssistCommand;
  if (command === 'none') return [];
  const groups = job.groups.filter((group): group is LaserGroup => group.kind !== 'cnc');
  const first = groups[0];
  if (first === undefined || first.airAssist) return [];
  const firstWithAir = groups.find((group) => group.airAssist);
  if (firstWithAir === undefined) {
    return [
      `Air assist is off for every operation, so this job never sends ${command}. ` +
        'Smoke settles as dark marks around the burn on wood; turn Air on in the ' +
        'operations table if the material needs it.',
    ];
  }
  const names = operationNames(layers);
  const firstName = names.get(first.layerId) ?? first.layerId;
  const airName = names.get(firstWithAir.layerId) ?? firstWithAir.layerId;
  return [
    `The first operation (${firstName}) runs with air assist off; ${command} is only sent ` +
      `before ${airName}. Expect smoke marks on the opening part of the burn; turn Air on ` +
      `for ${firstName} if it needs it.`,
  ];
}

function operationNames(layers: ReadonlyArray<Layer>): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const layer of layers) {
    for (const operation of outputOperationLayers(layer)) names.set(operation.id, operation.name);
  }
  return names;
}
