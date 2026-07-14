// applyCncTextDefaultsToNewLayer — H.6c "CNC text defaults". A fresh text
// layer must not inherit the CNC layer default of profile-outside, which
// CUTS THE LETTERS OUT and drops their counters (the o/e/a centers). Text
// v-carves when the mounted bit is a v-bit — the classic router text
// workflow — and engraves on-path otherwise. Only newly-created layers are
// touched; a layer the operator already configured is never rewritten.
//
// PROVISIONAL interpretation: the H.6 roadmap line "CNC text defaults" is
// otherwise unspecified in canon — flagged for maintainer review.

import { DEFAULT_CNC_LAYER_SETTINGS, type MachineConfig, type Scene } from '../../core/scene';
import { defaultCncTextCutType } from '../common/text-layer-policy';

export function applyCncTextDefaultsToNewLayer(
  scene: Scene,
  machine: MachineConfig | undefined,
  color: string,
  fontKey: string,
): Scene {
  if (machine === undefined || machine.kind !== 'cnc') return scene;
  const cutType = defaultCncTextCutType(machine, fontKey);
  return {
    ...scene,
    layers: scene.layers.map((layer) =>
      layer.color === color && layer.cnc === undefined
        ? { ...layer, cnc: { ...DEFAULT_CNC_LAYER_SETTINGS, cutType } }
        : layer,
    ),
  };
}
