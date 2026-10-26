// ADR-496: new laser operations take the active library's best recipe for this
// job's material, linked so Cut Settings and Job Review name the preset and
// say when the library has changed it. The laser counterpart of the CNC stock
// seeding (cnc-auto-seeding.ts).

import { applyMaterialRecipe } from '../../core/material-library';
import { bestRecipeForOperation } from '../../core/material-library/auto-recipe';
import {
  captureLayerOperationSettings,
  updateLayer,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
// Deep import: core/scene's barrel is ratcheted and may only shrink.
import { withoutInactiveLaserLeadSettings } from '../../core/scene/layer';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';

/** The layer with the preset's recipe applied and linked to it. */
export function linkedPresetLayer(
  layer: Layer,
  library: Pick<MaterialLibraryDocument, 'libraryId'>,
  preset: Pick<MaterialPreset, 'id' | 'revision' | 'recipe'>,
): Layer {
  const applied = applyMaterialRecipe(layer, preset.recipe);
  return {
    ...applied,
    materialBinding: {
      libraryId: library.libraryId,
      presetId: preset.id,
      presetRevision: preset.revision,
      lastResolved: captureLayerOperationSettings(applied),
    },
  };
}

/** The best preset for this operation on the job's material, or undefined. */
export function bestPresetForLayer(
  project: Project,
  library: MaterialLibraryDocument | null,
  layer: Layer,
): MaterialPreset | undefined {
  const material = project.jobSetup.laserMaterial;
  if (library === null || material === undefined || project.machine?.kind === 'cnc') {
    return undefined;
  }
  return bestRecipeForOperation(project.device, library.entries, material, layer.mode)?.candidate;
}

/** A fresh operation with the best recipe linked, when the job applies recipes itself. */
export function seedFreshLaserLayer(
  layer: Layer,
  project: Project,
  library: MaterialLibraryDocument | null,
): Layer {
  if (project.jobSetup.laserMaterial?.autoApplyRecipes !== true || library === null) return layer;
  const preset = bestPresetForLayer(project, library, layer);
  return preset === undefined ? layer : linkedPresetLayer(layer, library, preset);
}

/** Every layer not in `previousLayers` seeded as above. */
export function projectWithFreshLaserRecipes(
  previousLayers: ReadonlyArray<Layer>,
  project: Project,
  library: MaterialLibraryDocument | null,
): Project {
  if (project.jobSetup.laserMaterial?.autoApplyRecipes !== true || library === null) {
    return project;
  }
  const existing = new Set(previousLayers.map((layer) => layer.id));
  let changed = false;
  const layers = project.scene.layers.map((layer) => {
    if (existing.has(layer.id)) return layer;
    const seeded = seedFreshLaserLayer(layer, project, library);
    if (seeded !== layer) changed = true;
    return seeded;
  });
  return changed ? { ...project, scene: { ...project.scene, layers } } : project;
}

/**
 * A mode switch on an operation still exactly as its linked recipe left it
 * takes the best recipe for the new mode, so a cut switched to Fill does not
 * engrave at cutting power. Anything else keeps the switched layer.
 */
export function reseedSwitchedLaserLayer(
  before: Layer,
  after: Layer,
  project: Project,
  library: MaterialLibraryDocument | null,
): Layer {
  if (project.jobSetup.laserMaterial?.autoApplyRecipes !== true || library === null) return after;
  const binding = before.materialBinding;
  if (binding === undefined || binding.libraryId !== library.libraryId) return after;
  // Lead fields with both leads off change nothing (ADR-626), so turning
  // leads on and off again does not count as editing the recipe.
  if (
    !settingsEqual(
      withoutInactiveLaserLeadSettings(captureLayerOperationSettings(before)),
      withoutInactiveLaserLeadSettings(binding.lastResolved),
    )
  )
    return after;
  const preset = bestPresetForLayer(project, library, after);
  if (preset === undefined) {
    const { materialBinding: _dropped, ...unlinked } = after;
    return unlinked;
  }
  return linkedPresetLayer(after, library, preset);
}

/**
 * `setLayerParam`'s scene, with a mode switch reseeded as above. Eligibility is
 * the operation before the edit, whatever else the patch holds: the patch's
 * other fields are explicit edits and apply on top of the new recipe, as if
 * made after the switch. Cut Settings applies its Process switch together with
 * the fields edited after it, so it gives what the inspector's switch followed
 * by the same edits gives (audit 2026-10-21 06-P2-3).
 */
export function sceneWithModeSwitchRecipe(
  project: Project,
  updated: Scene,
  layerId: string,
  patch: Partial<Layer>,
  library: MaterialLibraryDocument | null,
): Scene {
  const { mode, ...edits } = patch;
  if (mode === undefined) return updated;
  const before = project.scene.layers.find((layer) => layer.id === layerId);
  if (before === undefined || before.mode === mode) return updated;
  const switched: Layer = { ...before, mode };
  const reseeded = reseedSwitchedLaserLayer(before, switched, project, library);
  if (reseeded === switched) return updated;
  const after: Layer = { ...reseeded, ...edits };
  return {
    ...updated,
    layers: updated.layers.map((layer) => (layer.id === layerId ? after : layer)),
  };
}

/** The operation as `setLayerParam(layerId, { mode })` would leave it. Cut
 * Settings shows this as soon as its Process changes, so Apply writes what the
 * dialog showed. */
export function layerAfterModeSwitch(
  project: Project,
  library: MaterialLibraryDocument | null,
  layerId: string,
  mode: Layer['mode'],
): Layer | undefined {
  const patch = { mode };
  const scene = updateLayer(project.scene, layerId, patch);
  return sceneWithModeSwitchRecipe(project, scene, layerId, patch, library).layers.find(
    (layer) => layer.id === layerId,
  );
}

function settingsEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
