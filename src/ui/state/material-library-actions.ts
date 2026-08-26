import {
  applyMaterialRecipe,
  captureMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  type MaterialRecipe,
} from '../../core/material-library';
import {
  captureLayerOperationSettings,
  type Layer,
  type Project,
  type Scene,
} from '../../core/scene';
import type { MaterialLibraryDocument } from '../../io/material-library';
import { pushUndo, type StateSlice } from './scene-mutations';

export const MATERIAL_LIBRARY_STATE_DEFAULTS = {
  materialLibrary: null,
  materialLibraryDirty: false,
} as const;

export type MaterialLibraryState = {
  readonly materialLibrary: MaterialLibraryDocument | null;
  readonly materialLibraryDirty: boolean;
};

export type MaterialLibraryActions = {
  readonly setMaterialLibrary: (library: MaterialLibraryDocument | null) => void;
  readonly markMaterialLibrarySaved: () => void;
  readonly assignMaterialPresetToLayer: (layerId: string, presetId: string) => boolean;
  readonly deleteMaterialPreset: (presetId: string) => boolean;
  readonly linkMaterialPresetToLayer: (layerId: string, presetId: string) => boolean;
  readonly refreshLinkedMaterialLayer: (layerId: string) => boolean;
};

export function currentMaterialLibraryState(state: MaterialLibraryState): MaterialLibraryState {
  return {
    materialLibrary: state.materialLibrary,
    materialLibraryDirty: state.materialLibraryDirty,
  };
}

type MaterialLibraryActionState = StateSlice & MaterialLibraryState;

type ProjectMutation = {
  readonly project: Project;
  readonly undoStack: ReadonlyArray<Project>;
  readonly redoStack: [];
  readonly dirty: true;
};

type EmptyMutation = Record<string, never>;

type MaterialLibrarySet = (
  fn: (
    state: MaterialLibraryActionState,
  ) => Partial<MaterialLibraryState> | ProjectMutation | EmptyMutation,
) => void;

export function materialLibraryActions(set: MaterialLibrarySet): MaterialLibraryActions {
  return {
    setMaterialLibrary: (library) =>
      set(() => ({ materialLibrary: library, materialLibraryDirty: false })),
    markMaterialLibrarySaved: () => set(() => ({ materialLibraryDirty: false })),
    // Apply (LightBurn "Assign"): copy the preset recipe onto the layer via the
    // normal scene mutation path, so the layer stays editable and the change is
    // project-undoable. The preset is never linked to later layer edits.
    assignMaterialPresetToLayer: (layerId, presetId) => {
      let assigned = false;
      set((state) => {
        if (state.materialLibrary === null) return {};
        const preset = state.materialLibrary.entries.find((entry) => entry.id === presetId);
        if (preset === undefined) return {};
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        if (recipeMatchesLayer(target, preset.recipe)) return {};

        assigned = true;
        return {
          project: {
            ...state.project,
            scene: replaceLayer(state.project.scene, applyMaterialRecipe(target, preset.recipe)),
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return assigned;
    },
    deleteMaterialPreset: (presetId) => deleteMaterialPreset(set, presetId),
    linkMaterialPresetToLayer: (layerId, presetId) =>
      applyLinkedPreset(set, layerId, presetId, false),
    refreshLinkedMaterialLayer: (layerId) => applyLinkedPreset(set, layerId, null, true),
  };
}

function applyLinkedPreset(
  set: MaterialLibrarySet,
  layerId: string,
  presetId: string | null,
  refresh: boolean,
): boolean {
  let applied = false;
  set((state) => {
    const target = state.project.scene.layers.find((layer) => layer.id === layerId);
    if (target === undefined || state.materialLibrary === null) return {};
    const linkedPresetId = refresh ? target.materialBinding?.presetId : presetId;
    if (linkedPresetId === undefined || linkedPresetId === null) return {};
    const preset = state.materialLibrary.entries.find((entry) => entry.id === linkedPresetId);
    if (preset === undefined) return {};
    const recipe = materialRecipePatch(preset.recipe);
    const materialBinding = {
      libraryId: state.materialLibrary.libraryId,
      presetId: preset.id,
      presetRevision: preset.revision,
      lastResolved: { ...captureLayerOperationSettings(target), ...recipe },
    };
    if (recipeMatchesLayer(target, preset.recipe) && bindingMatches(target, materialBinding)) {
      return {};
    }
    const next = {
      ...applyMaterialRecipe(target, preset.recipe),
      materialBinding,
    };
    applied = true;
    return {
      project: {
        ...state.project,
        scene: replaceLayer(state.project.scene, next),
      },
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    };
  });
  return applied;
}

function deleteMaterialPreset(set: MaterialLibrarySet, presetId: string): boolean {
  let deleted = false;
  set((state) => {
    if (state.materialLibrary === null) return {};
    const entries = state.materialLibrary.entries.filter((entry) => entry.id !== presetId);
    if (entries.length === state.materialLibrary.entries.length) return {};

    deleted = true;
    return {
      materialLibrary: { ...state.materialLibrary, entries },
      materialLibraryDirty: true,
    };
  });
  return deleted;
}

function recipeMatchesLayer(layer: Layer, recipe: MaterialRecipe): boolean {
  const patch = materialRecipePatch(recipe);
  const current = materialRecipePatch(captureMaterialRecipe(layer));
  return MATERIAL_RECIPE_FIELDS.every((field) => current[field] === patch[field]);
}

function bindingMatches(
  layer: Layer,
  expected: Pick<
    NonNullable<Layer['materialBinding']>,
    'libraryId' | 'presetId' | 'presetRevision'
  >,
): boolean {
  const binding = layer.materialBinding;
  return (
    binding?.libraryId === expected.libraryId &&
    binding.presetId === expected.presetId &&
    binding.presetRevision === expected.presetRevision
  );
}

function replaceLayer(scene: Scene, next: Layer): Scene {
  return {
    ...scene,
    layers: scene.layers.map((layer) => (layer.id === next.id ? next : layer)),
  };
}
