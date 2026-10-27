// A bit or material chosen for one CNC operation on its Artwork card (ADR-481),
// as one transform the card and Remote Control share. A material-recipe
// operation is recalculated for a new bit, and a manual one keeps its values
// (ADR-306 Amendment 3 item 2, ADR-233 decision 5), exactly as Machine Setup's
// tool plan does (sceneWithCncStartupOperationDrafts).

import type { CncMachineStarterLiveCaps } from '../../core/cnc/machine-starters';
import type { DeviceProfile } from '../../core/devices';
import type { CncLayerSettings, CncMachineConfig, Layer } from '../../core/scene';
import { cncOperationMaterialKey } from './cnc-feed-provenance';
import {
  cncStartupOperationDraft,
  sceneWithCncStartupOperationDrafts,
  type CncStartupOperationDraft,
} from './cnc-startup-setup';

export type CncOperationChoice = Partial<Omit<CncStartupOperationDraft, 'layerId'>>;

/** The operation's settings after the choice, or null when it changes nothing. */
export function cncSettingsAfterOperationChoice(input: {
  readonly layer: Layer;
  readonly settings: CncLayerSettings;
  readonly machine: CncMachineConfig;
  readonly profile: DeviceProfile;
  readonly liveCaps: CncMachineStarterLiveCaps | null;
  readonly choice: CncOperationChoice;
}): CncLayerSettings | null {
  const operation = cncOperationWithMaterialBinding(input.layer, input.settings);
  const scene = sceneWithCncStartupOperationDrafts({
    scene: { layers: [operation], objects: [] },
    machine: input.machine,
    profile: input.profile,
    liveCaps: input.liveCaps,
    drafts: [{ ...cncStartupOperationDraft(operation), ...input.choice }],
  });
  const next = scene.layers[0];
  return next === operation || next?.cnc === undefined ? null : next.cnc;
}

// Older recipes can carry their material only in provenance. Present and edit
// that binding consistently without changing the project merely by opening it.
export function cncOperationWithMaterialBinding(layer: Layer, settings: CncLayerSettings): Layer {
  const materialKey = cncOperationMaterialKey(settings);
  return {
    ...layer,
    cnc: materialKey === undefined ? settings : { ...settings, materialKey },
  };
}
