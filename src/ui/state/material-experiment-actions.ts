import { captureMaterialRecipe } from '../../core/material-library';
import type {
  ExperimentCell,
  MaterialExperiment,
} from '../../core/material-library/material-experiment';
import type {
  ProcessRecipe,
  ProcessRecipeResult,
} from '../../core/material-library/process-recipe';
import { createLayer } from '../../core/scene';
import type { MaterialLibraryDocument, MaterialPreset } from '../../io/material-library';
import { parseMaterialExperiments } from '../../io/material-library/material-experiment-io';
import type { MaterialLibraryState } from './material-library-actions';

type Set = (fn: (state: MaterialLibraryState) => Partial<MaterialLibraryState>) => unknown;
export type MaterialExperimentActions = {
  readonly upsertMaterialExperiment: (
    experiment: MaterialExperiment,
  ) => ProcessRecipeResult<string>;
  readonly deleteMaterialExperiment: (id: string) => void;
  readonly saveExperimentCellAsRecipe: (
    experimentId: string,
    cellId: string,
    name: string,
  ) => ProcessRecipeResult<string>;
};

export function materialExperimentActions(set: Set): MaterialExperimentActions {
  return {
    upsertMaterialExperiment: (experiment) => {
      let result: ProcessRecipeResult<string> = {
        kind: 'invalid',
        reason: 'Create or open a material library first.',
      };
      set((state) => {
        if (state.materialLibrary === null) return {};
        const records = [
          ...(state.materialLibrary.experiments ?? []).filter(
            (record) => record.id !== experiment.id,
          ),
          experiment,
        ];
        const parsed = parseMaterialExperiments(records);
        if (parsed.kind === 'invalid') {
          result = parsed;
          return {};
        }
        result = { kind: 'ok', value: experiment.id };
        return {
          materialLibrary: { ...state.materialLibrary, experiments: parsed.value },
          materialLibraryDirty: true,
        };
      });
      return result;
    },
    deleteMaterialExperiment: (id) =>
      set((state) =>
        state.materialLibrary === null
          ? {}
          : {
              materialLibrary: {
                ...state.materialLibrary,
                experiments: (state.materialLibrary.experiments ?? []).filter(
                  (record) => record.id !== id,
                ),
              },
              materialLibraryDirty: true,
            },
      ),
    saveExperimentCellAsRecipe: (experimentId, cellId, name) =>
      saveCell(set, experimentId, cellId, name),
  };
}

function saveCell(
  set: Set,
  experimentId: string,
  cellId: string,
  name: string,
): ProcessRecipeResult<string> {
  let result: ProcessRecipeResult<string> = {
    kind: 'invalid',
    reason: 'Choose an experiment cell and give the recipe a name.',
  };
  set((state) => {
    const library = state.materialLibrary;
    const experiment = library?.experiments?.find((record) => record.id === experimentId);
    const cell = experiment?.cells.find((record) => record.id === cellId);
    if (
      library === null ||
      experiment === undefined ||
      cell === undefined ||
      name.trim() === '' ||
      name.trim().length > 200
    )
      return {};
    const id = uniqueRecipeId(library, `${experimentId}-${cellId}`);
    result = { kind: 'ok', value: id };
    return {
      materialLibrary: libraryWithCapturedCell(library, experiment, cell, id, name),
      materialLibraryDirty: true,
    };
  });
  return result;
}

function libraryWithCapturedCell(
  library: MaterialLibraryDocument,
  experiment: MaterialExperiment,
  cell: ExperimentCell,
  id: string,
  name: string,
): MaterialLibraryDocument {
  const process = {
    ...cell.process,
    id,
    name: name.trim(),
    description: [name.trim(), experiment.notes, cell.observation].filter(Boolean).join('\n'),
    revision: '1',
  };
  const material = experiment.machineKind === 'laser' && process.steps.length === 1;
  const updated: MaterialExperiment = {
    ...experiment,
    selectedCellId: cell.id,
    cells: experiment.cells.map((entry) =>
      entry.id !== cell.id
        ? entry
        : { ...entry, recipeRef: { kind: material ? 'material' : 'process', id, revision: '1' } },
    ),
  };
  return {
    ...library,
    ...(material
      ? { entries: [...library.entries, capturedCellPreset(experiment, cell, process)] }
      : { processRecipes: [...(library.processRecipes ?? []), process] }),
    experiments: (library.experiments ?? []).map((record) =>
      record.id === experiment.id ? updated : record,
    ),
  };
}

function capturedCellPreset(
  experiment: MaterialExperiment,
  cell: ExperimentCell,
  process: ProcessRecipe,
): MaterialPreset {
  const first = process.steps[0];
  if (first === undefined) throw new Error('A captured process needs a step.');
  return {
    id: process.id,
    materialName: experiment.material.trim() || 'Unspecified material',
    operation:
      first.settings.mode === 'line'
        ? 'cut'
        : first.settings.mode === 'image'
          ? 'image'
          : 'engrave',
    ...(experiment.thicknessMm === undefined
      ? { title: process.name }
      : { thicknessMm: experiment.thicknessMm }),
    ...(experiment.profileId === undefined ? {} : { profileId: experiment.profileId }),
    description: process.description,
    revision: '1',
    calibrationProvenance: `User-selected experiment ${experiment.name}, cell ${cell.row + 1}/${cell.column + 1}. Physical completion is not verified by this record.`,
    recipe: captureMaterialRecipe({
      ...createLayer({ id: process.id, color: first.color }),
      ...first.settings,
    }),
  };
}

function uniqueRecipeId(library: MaterialLibraryDocument, base: string): string {
  const ids = new Set(
    [...library.entries, ...(library.processRecipes ?? [])].map((recipe) => recipe.id),
  );
  let suffix = 1;
  while (ids.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}
