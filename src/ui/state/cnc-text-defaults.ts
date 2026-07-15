// applyCncTextDefaultsToNewLayer — H.6c "CNC text defaults". A fresh text
// layer must not inherit the CNC layer default of profile-outside, which
// CUTS THE LETTERS OUT and drops their counters (the o/e/a centers). Text
// v-carves when the mounted bit is a v-bit — the classic router text
// workflow — and engraves on-path otherwise. Only newly-created layers are
// touched; a layer the operator already configured is never rewritten.
//
// PROVISIONAL interpretation: the H.6 roadmap line "CNC text defaults" is
// otherwise unspecified in canon — flagged for maintainer review.

import {
  DEFAULT_CNC_LAYER_SETTINGS,
  sceneObjectUsesOperation,
  type MachineConfig,
  type Scene,
} from '../../core/scene';
import { defaultCncTextCutType } from '../common/text-layer-policy';

export function applyCncTextDefaultsToNewLayer(
  scene: Scene,
  machine: MachineConfig | undefined,
  operationId: string,
  fontKey: string,
): Scene {
  if (machine === undefined || machine.kind !== 'cnc') return scene;
  const cutType = defaultCncTextCutType(machine, fontKey);
  return {
    ...scene,
    layers: scene.layers.map((layer) =>
      layer.id === operationId && layer.cnc === undefined
        ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } }
        : layer,
    ),
  };
}

/** Seeds text-only operations when an existing laser project is switched to
 * CNC. Explicit CNC settings always win, and mixed artwork operations remain
 * manual because one automatic text policy would be unsafe for their shapes. */
export function applyCncTextDefaultsForScene(
  scene: Scene,
  machine: MachineConfig | undefined,
): Scene {
  if (machine === undefined || machine.kind !== 'cnc') return scene;
  let changed = false;
  const layers = scene.layers.map((operation) => {
    if (operation.cnc !== undefined) return operation;
    const users = scene.objects.filter((object) => sceneObjectUsesOperation(object, operation));
    if (users.length === 0 || users.some((object) => object.kind !== 'text')) return operation;
    const cutTypes = users.map((object) =>
      object.kind === 'text' ? defaultCncTextCutType(machine, object.fontKey) : 'engrave',
    );
    const cutType = cutTypes.every((candidate) => candidate === cutTypes[0])
      ? (cutTypes[0] ?? 'engrave')
      : 'engrave';
    changed = true;
    return { ...operation, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } };
  });
  return changed ? { ...scene, layers } : scene;
}
