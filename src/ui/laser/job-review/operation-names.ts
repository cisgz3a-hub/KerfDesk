// Operation id to the name the operator sees in the operations table.
//
// Job Review advisories name the operation they are about, but a Job group
// carries only its `layerId`. Shared by the air-assist advisories so they
// cannot disagree about what an operation is called, and so a job whose layers
// were not supplied falls back to the raw id in exactly one place.

import { outputOperationLayers, type Layer } from '../../../core/scene';

export function operationNames(layers: ReadonlyArray<Layer>): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const layer of layers) {
    for (const operation of outputOperationLayers(layer)) names.set(operation.id, operation.name);
  }
  return names;
}
