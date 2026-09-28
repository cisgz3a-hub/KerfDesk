// ADR-496: new laser operations take the active library's best recipe for this
// job's material, linked so Cut Settings and Job Review name the preset and
// say when the library has changed it. The laser counterpart of the CNC stock
// seeding (cnc-auto-seeding.ts).

import {
  applyMaterialRecipe,
  materialRecipePatch,
  type MaterialRecipe,
} from '../../core/material-library';
import { bestRecipeForOperation } from '../../core/material-library/auto-recipe';
import {
  captureLayerOperationSettings,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';

/** The layer with the preset's recipe applied and linked to it. */
export function linkedPresetLayer(
  layer: Layer,
  library: Pick<MaterialLibraryDocument, 'libraryId'>,
  preset: Pick<MaterialPreset, 'id' | 'revision' | 'recipe'>,
): Layer {
  const recipe: MaterialRecipe = materialRecipePatch(preset.recipe);
  return {
    ...applyMaterialRecipe(layer, preset.recipe),
    materialBinding: {
      libraryId: library.libraryId,
      presetId: preset.id,
      presetRevision: preset.revision,
      lastResolved: { ...captureLayerOperationSettings(layer), ...recipe },
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
  if (!settingsEqual(captureLayerOperationSettings(before), binding.lastResolved)) return after;
  const preset = bestPresetForLayer(project, library, after);
  if (preset === undefined) {
    const { materialBinding: _dropped, ...unlinked } = after;
    return unlinked;
  }
  return linkedPresetLayer(after, library, preset);
}

/** `setLayerParam`'s scene, with a pure mode switch reseeded as above. */
export function sceneWithModeSwitchRecipe(
  project: Project,
  updated: Scene,
  layerId: string,
  patch: Partial<Layer>,
  library: MaterialLibraryDocument | null,
): Scene {
  const keys = Object.keys(patch);
  if (keys.length !== 1 || keys[0] !== 'mode') return updated;
  const before = project.scene.layers.find((layer) => layer.id === layerId);
  const after = updated.layers.find((layer) => layer.id === layerId);
  if (before === undefined || after === undefined || before.mode === after.mode) return updated;
  const reseeded = reseedSwitchedLaserLayer(before, after, project, library);
  if (reseeded === after) return updated;
  return {
    ...updated,
    layers: updated.layers.map((layer) => (layer.id === layerId ? reseeded : layer)),
  };
}

function settingsEqual(a: object, b: object): boolean {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].every((key) => JSON.stringify(left[key]) === JSON.stringify(right[key]));
}
