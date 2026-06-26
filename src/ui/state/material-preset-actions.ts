// Add-or-replace a material preset in the active library (ADR-093, F-ML2).
//
// The create/edit wizard builds a complete MaterialPreset and commits it here.
// This supersedes the layer-snapshot create/update path for authoring; presets
// are app-level like the library, so this never touches the project undo stack.

import { materialRecipePatch } from '../../core/material-library';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';

export type MaterialPresetActions = {
  readonly upsertMaterialPreset: (preset: MaterialPreset) => boolean;
};

type MaterialPresetActionState = {
  readonly materialLibrary: MaterialLibraryDocument | null;
  readonly materialLibraryDirty: boolean;
};

type MaterialPresetPatch = Partial<MaterialPresetActionState>;
type EmptyPatch = Record<string, never>;

type MaterialPresetSet = (
  fn: (state: MaterialPresetActionState) => MaterialPresetPatch | EmptyPatch,
) => void;

export function materialPresetActions(set: MaterialPresetSet): MaterialPresetActions {
  return {
    upsertMaterialPreset: (preset) => {
      let upserted = false;
      set((state) => {
        if (state.materialLibrary === null) return {};
        const normalized: MaterialPreset = {
          ...preset,
          recipe: materialRecipePatch(preset.recipe),
        };
        upserted = true;
        return {
          materialLibrary: {
            ...state.materialLibrary,
            entries: upsertEntry(state.materialLibrary.entries, normalized),
          },
          materialLibraryDirty: true,
        };
      });
      return upserted;
    },
  };
}

function upsertEntry(
  entries: ReadonlyArray<MaterialPreset>,
  preset: MaterialPreset,
): ReadonlyArray<MaterialPreset> {
  const index = entries.findIndex((entry) => entry.id === preset.id);
  if (index < 0) return [...entries, preset];
  return entries.map((entry, i) => (i === index ? preset : entry));
}
