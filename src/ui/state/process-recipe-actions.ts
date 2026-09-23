import { applyProcessRecipe } from '../../core/material-library/apply-process-recipe';
import { captureProcessRecipe } from '../../core/material-library/capture-process-recipe';
import type {
  ProcessRecipe,
  ProcessRecipeResult,
} from '../../core/material-library/process-recipe';
import { parseProcessRecipes } from '../../io/material-library/process-recipe-io';
import { PROJECT_SCENE_LIMITS } from '../../io/project/project-scene-integrity-validator';
import type { MaterialLibraryState } from './material-library-actions';
import { pushUndo, type StateSlice } from './scene-mutations';

type RecipeState = StateSlice &
  MaterialLibraryState & {
    readonly selectedObjectId: string | null;
    readonly additionalSelectedIds: ReadonlySet<string>;
  };
type RecipePatch = Partial<MaterialLibraryState> &
  Partial<StateSlice> & {
    readonly dirty?: boolean;
    readonly redoStack?: [];
  };
type RecipeSet = (fn: (state: RecipeState) => RecipePatch) => void;

export type ProcessRecipeActions = {
  readonly saveSelectedProcessRecipe: (name: string) => ProcessRecipeResult<ProcessRecipe>;
  readonly applyProcessRecipeToSelection: (id: string) => ProcessRecipeResult<number>;
  readonly deleteProcessRecipe: (id: string) => void;
};

export function processRecipeActions(set: RecipeSet): ProcessRecipeActions {
  return {
    saveSelectedProcessRecipe: (name) => saveRecipe(set, name),
    applyProcessRecipeToSelection: (id) => applyRecipe(set, id),
    deleteProcessRecipe: (id) =>
      set((state) =>
        state.materialLibrary === null
          ? {}
          : {
              materialLibrary: {
                ...state.materialLibrary,
                processRecipes:
                  state.materialLibrary.processRecipes?.filter((recipe) => recipe.id !== id) ?? [],
              },
              materialLibraryDirty: true,
            },
      ),
  };
}

function saveRecipe(set: RecipeSet, name: string): ProcessRecipeResult<ProcessRecipe> {
  let result: ProcessRecipeResult<ProcessRecipe> = {
    kind: 'invalid',
    reason: 'Create or open a library first.',
  };
  set((state) => {
    if (state.materialLibrary === null) return {};
    const ids = selectedIds(state);
    if (ids.length !== 1) {
      result = { kind: 'invalid', reason: 'Select exactly one artwork to save its process.' };
      return {};
    }
    const recipes = state.materialLibrary.processRecipes ?? [];
    let index = 1;
    while (recipes.some((recipe) => recipe.id === `process-${index}`)) index += 1;
    result = captureProcessRecipe(state.project, ids[0] as string, {
      id: `process-${index}`,
      name,
      description: '',
      revision: '1',
    });
    if (result.kind === 'invalid') return {};
    const validated = parseProcessRecipes([result.value]);
    if (validated.kind === 'invalid') {
      result = validated;
      return {};
    }
    return {
      materialLibrary: { ...state.materialLibrary, processRecipes: [...recipes, result.value] },
      materialLibraryDirty: true,
    };
  });
  return result;
}

function applyRecipe(set: RecipeSet, id: string): ProcessRecipeResult<number> {
  let result: ProcessRecipeResult<number> = {
    kind: 'invalid',
    reason: 'Choose a saved process recipe.',
  };
  set((state) => {
    const recipe = state.materialLibrary?.processRecipes?.find((candidate) => candidate.id === id);
    if (recipe === undefined) return {};
    const ids = selectedIds(state);
    const applied = applyProcessRecipe(state.project, ids, recipe);
    if (applied.kind === 'invalid') {
      result = applied;
      return {};
    }
    if (applied.value.scene.layers.length > PROJECT_SCENE_LIMITS.layers) {
      result = {
        kind: 'invalid',
        reason: `This recipe would exceed the project limit of ${PROJECT_SCENE_LIMITS.layers} operations. Apply to fewer artworks or remove unused operations.`,
      };
      return {};
    }
    result = { kind: 'ok', value: ids.length };
    return {
      project: applied.value,
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    };
  });
  return result;
}

function selectedIds(state: RecipeState): string[] {
  return [
    ...new Set([
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ]),
  ].filter((id) => state.project.scene.objects.some((object) => object.id === id));
}
