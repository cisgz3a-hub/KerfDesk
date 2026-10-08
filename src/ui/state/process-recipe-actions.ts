import { applyProcessRecipe } from '../../core/material-library/apply-process-recipe';
import { applyProcessRecipeTemplate } from '../../core/material-library/apply-process-recipe-template';
import { captureProcessRecipeTemplate } from '../../core/material-library/capture-process-recipe-template';
import { applyProcessRecipeSheets } from './process-recipe-sheet-application';
import { captureProcessRecipe } from '../../core/material-library/capture-process-recipe';
import type {
  ProcessRecipe,
  ProcessRecipeResult,
  ProcessRecipeRole,
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
// The edition-aware setter returns false when an authoring change awaits Pro.
type RecipeSet = (fn: (state: RecipeState) => RecipePatch) => unknown;

export type ProcessRecipeActions = {
  readonly saveSelectedProcessRecipe: (name: string) => ProcessRecipeResult<ProcessRecipe>;
  readonly saveSelectedMachiningTemplate: (name: string) => ProcessRecipeResult<ProcessRecipe>;
  readonly updateProcessRecipeRoles: (
    id: string,
    roles: ReadonlyArray<ProcessRecipeRole>,
    dependencies: ReadonlyArray<ReadonlyArray<number>>,
  ) => ProcessRecipeResult<ProcessRecipe>;
  readonly applyProcessRecipeToSelection: (
    id: string,
    reviewedSignature?: string,
  ) => ProcessRecipeResult<number>;
  readonly reapplyProcessRecipeApplication: (
    id: string,
    reviewedSignature: string,
  ) => ProcessRecipeResult<number>;
  readonly applyProcessRecipeToSheets: (
    id: string,
    sheetIds: ReadonlyArray<string>,
    reviewedSignature: string,
  ) => ProcessRecipeResult<number>;
  readonly deleteProcessRecipe: (id: string) => void;
};

export function processRecipeActions(set: RecipeSet): ProcessRecipeActions {
  return {
    saveSelectedProcessRecipe: (name) => saveRecipe(set, name),
    saveSelectedMachiningTemplate: (name) => saveRecipe(set, name, true),
    updateProcessRecipeRoles: (id, roles, dependencies) =>
      updateRecipeRoles(set, id, roles, dependencies),
    applyProcessRecipeToSelection: (id, signature) => applyRecipe(set, id, signature),
    reapplyProcessRecipeApplication: (id, signature) => applyRecipe(set, '', signature, id),
    applyProcessRecipeToSheets: (id, sheetIds, signature) =>
      applyRecipeSheets(set, id, sheetIds, signature),
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

function saveRecipe(
  set: RecipeSet,
  name: string,
  template = false,
): ProcessRecipeResult<ProcessRecipe> {
  let result: ProcessRecipeResult<ProcessRecipe> = {
    kind: 'invalid',
    reason: 'Create or open a library first.',
  };
  set((state) => {
    if (state.materialLibrary === null) return {};
    const ids = selectedIds(state);
    if (template ? ids.length === 0 : ids.length !== 1) {
      result = { kind: 'invalid', reason: 'Select exactly one artwork to save its process.' };
      return {};
    }
    const recipes = state.materialLibrary.processRecipes ?? [];
    let index = 1;
    while (recipes.some((recipe) => recipe.id === `process-${index}`)) index += 1;
    const capture = template
      ? captureProcessRecipeTemplate
      : (
          project: RecipeState['project'],
          objectIds: ReadonlyArray<string>,
          metadata: Pick<ProcessRecipe, 'id' | 'name' | 'description' | 'revision'>,
        ) => captureProcessRecipe(project, objectIds[0] as string, metadata);
    result = capture(state.project, ids, {
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

function applyRecipe(
  set: RecipeSet,
  id: string,
  signature?: string,
  applicationId?: string,
): ProcessRecipeResult<number> {
  let result: ProcessRecipeResult<number> = {
    kind: 'invalid',
    reason: 'Choose a saved process recipe.',
  };
  const committed = set((state) => {
    const selection = recipeSelection(state, id, applicationId);
    if (selection === undefined) return {};
    const { recipe, ids } = selection;
    const applied = applyReviewedRecipe(state.project, ids, recipe, signature, applicationId);
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
    result = {
      kind: 'ok',
      value: ids.filter((id) => applied.value.scene.objects.some((object) => object.id === id))
        .length,
    };
    if (applied.value === state.project) return {};
    return {
      project: applied.value,
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    };
  });
  return committed === false
    ? { kind: 'invalid', reason: 'This process needs Pro. Unlock Pro to apply it.' }
    : result;
}

function selectedIds(state: RecipeState): string[] {
  return [
    ...new Set([
      ...(state.selectedObjectId === null ? [] : [state.selectedObjectId]),
      ...state.additionalSelectedIds,
    ]),
  ].filter((id) => state.project.scene.objects.some((object) => object.id === id));
}

function updateRecipeRoles(
  set: RecipeSet,
  id: string,
  roles: ReadonlyArray<ProcessRecipeRole>,
  dependencies: ReadonlyArray<ReadonlyArray<number>>,
): ProcessRecipeResult<ProcessRecipe> {
  let result: ProcessRecipeResult<ProcessRecipe> = {
    kind: 'invalid',
    reason: 'Choose a saved machining template.',
  };
  set((state) => {
    const library = state.materialLibrary;
    const recipe = library?.processRecipes?.find((entry) => entry.id === id);
    if (recipe === undefined || library === null || recipe.roles === undefined) return {};
    const parsed = parseProcessRecipes([
      {
        ...recipe,
        roles,
        revision: String((Number(recipe.revision) || 0) + 1),
        steps: recipe.steps.map((step, index) => ({
          ...step,
          dependsOn: dependencies[index] ?? [],
        })),
      },
    ]);
    if (parsed.kind === 'invalid') {
      result = parsed;
      return {};
    }
    const updated = parsed.value[0];
    if (updated === undefined) return {};
    result = { kind: 'ok', value: updated };
    return {
      materialLibrary: {
        ...library,
        processRecipes: (library.processRecipes ?? []).map((entry) =>
          entry.id === id ? updated : entry,
        ),
      },
      materialLibraryDirty: true,
    };
  });
  return result;
}
function applyRecipeSheets(
  set: RecipeSet,
  id: string,
  sheetIds: ReadonlyArray<string>,
  signature: string,
): ProcessRecipeResult<number> {
  let result: ProcessRecipeResult<number> = {
    kind: 'invalid',
    reason: 'Choose a saved machining template.',
  };
  const committed = set((state) => {
    const recipe = state.materialLibrary?.processRecipes?.find((entry) => entry.id === id);
    if (recipe === undefined || recipe.roles === undefined) return {};
    const applied = applyProcessRecipeSheets(state.project, sheetIds, recipe, signature);
    if (applied.kind === 'invalid') {
      result = applied;
      return {};
    }
    result = { kind: 'ok', value: applied.value.artworkCount };
    if (JSON.stringify(applied.value.project) === JSON.stringify(state.project)) return {};
    return {
      project: applied.value.project,
      undoStack: pushUndo(state.project, state.undoStack),
      redoStack: [],
      dirty: true,
    };
  });
  return committed === false
    ? { kind: 'invalid', reason: 'This process needs Pro. Unlock Pro to apply it.' }
    : result;
}

function recipeSelection(
  state: RecipeState,
  id: string,
  applicationId: string | undefined,
): { recipe: ProcessRecipe; ids: ReadonlyArray<string> } | undefined {
  const application = state.project.processRecipeApplications?.find(
    (entry) => entry.id === applicationId,
  );
  const recipe =
    application?.recipe ??
    state.materialLibrary?.processRecipes?.find((candidate) => candidate.id === id);
  return recipe === undefined
    ? undefined
    : { recipe, ids: application?.objectIds ?? selectedIds(state) };
}
function applyReviewedRecipe(
  project: RecipeState['project'],
  ids: ReadonlyArray<string>,
  recipe: ProcessRecipe,
  signature: string | undefined,
  applicationId: string | undefined,
): ProcessRecipeResult<RecipeState['project']> {
  if (recipe.roles === undefined) return applyProcessRecipe(project, ids, recipe);
  if (signature === undefined)
    return { kind: 'invalid', reason: 'Review the template matches before applying.' };
  return applyProcessRecipeTemplate(project, ids, recipe, {
    reviewedSignature: signature,
    applicationId,
  });
}
