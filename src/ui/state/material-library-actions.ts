import {
  captureMaterialRecipe,
  MATERIAL_RECIPE_FIELDS,
  materialRecipePatch,
  type MaterialRecipe,
} from '../../core/material-library';
import { updateLayer, type Layer, type Project } from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';
import { pushUndo, type StateSlice } from './scene-mutations';

export const MATERIAL_LIBRARY_STATE_DEFAULTS = {
  materialLibrary: null,
  materialLibraryDirty: false,
} as const;

export type MaterialLibraryState = {
  readonly materialLibrary: MaterialLibraryDocument | null;
  readonly materialLibraryDirty: boolean;
};

export type CreateMaterialPresetInput = Omit<MaterialPreset, 'recipe'>;

export type MaterialLibraryActions = {
  readonly setMaterialLibrary: (library: MaterialLibraryDocument | null) => void;
  readonly createMaterialPresetFromLayer: (
    layerId: string,
    input: CreateMaterialPresetInput,
  ) => MaterialPreset | null;
  readonly assignMaterialPresetToLayer: (layerId: string, presetId: string) => boolean;
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
    createMaterialPresetFromLayer: (layerId, input) => {
      let created: MaterialPreset | null = null;
      set((state) => {
        if (state.materialLibrary === null) return {};
        const target = state.project.scene.layers.find((layer) => layer.id === layerId);
        if (target === undefined) return {};
        if (state.materialLibrary.entries.some((entry) => entry.id === input.id.trim())) return {};

        const preset = createPreset(input, captureMaterialRecipe(target));
        if (preset === null) return {};

        created = preset;
        return {
          materialLibrary: {
            ...state.materialLibrary,
            entries: [...state.materialLibrary.entries, preset],
          },
          materialLibraryDirty: true,
        };
      });
      return created;
    },
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
            scene: updateLayer(state.project.scene, layerId, materialRecipePatch(preset.recipe)),
          },
          undoStack: pushUndo(state.project, state.undoStack),
          redoStack: [],
          dirty: true,
        };
      });
      return assigned;
    },
  };
}

function createPreset(
  input: CreateMaterialPresetInput,
  recipe: MaterialRecipe,
): MaterialPreset | null {
  const strings = normalizeStrings(input);
  if (strings === null) return null;

  const label = normalizeThicknessLabel(input);
  if (label === null) return null;

  return {
    id: strings.id,
    materialName: strings.materialName,
    ...label,
    description: strings.description,
    recipe: materialRecipePatch(recipe),
    revision: strings.revision,
  };
}

function normalizeStrings(input: CreateMaterialPresetInput): {
  readonly id: string;
  readonly materialName: string;
  readonly description: string;
  readonly revision: string;
} | null {
  const id = input.id.trim();
  const materialName = input.materialName.trim();
  const description = input.description.trim();
  const revision = input.revision.trim();

  if (
    id.length === 0 ||
    materialName.length === 0 ||
    description.length === 0 ||
    revision.length === 0
  ) {
    return null;
  }
  return { id, materialName, description, revision };
}

function normalizeThicknessLabel(
  input: CreateMaterialPresetInput,
): { readonly thicknessMm: number } | { readonly title: string } | null {
  const hasThickness = input.thicknessMm !== undefined;
  const normalizedTitle = input.title?.trim();
  const hasTitle = normalizedTitle !== undefined;

  if (hasTitle && normalizedTitle.length === 0) return null;
  if (hasThickness === hasTitle) return null;

  if (hasThickness) {
    const thicknessMm = input.thicknessMm;
    if (typeof thicknessMm !== 'number' || !Number.isFinite(thicknessMm) || thicknessMm <= 0) {
      return null;
    }
    return { thicknessMm };
  }

  if (normalizedTitle === undefined) return null;
  return { title: normalizedTitle };
}

function recipeMatchesLayer(layer: Layer, recipe: MaterialRecipe): boolean {
  const patch = materialRecipePatch(recipe);
  return MATERIAL_RECIPE_FIELDS.every((field) => layer[field] === patch[field]);
}
