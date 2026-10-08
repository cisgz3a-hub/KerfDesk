import type {
  ProductionNestDefinition,
  ProductionNestResult,
} from '../../core/nesting/production-nest';
import type { ProcessRecipeResult } from '../../core/material-library/process-recipe';
import type { AppState } from './store';
import { prepareProductionNest, type PreparedProductionNest } from './prepare-production-nest';
import { materializeProductionSheets } from './production-nest-sheet-materialize';
import { parseProductionNestDefinition } from '../../io/project/project-production-nest-validator';
import { visitWorkflowArchives } from '../../io/project/project-workflow-archives';
import { pushUndo } from './scene-mutations';

export type ProductionNestActions = {
  readonly saveProductionNestDefinition: (
    definition: ProductionNestDefinition,
  ) => ProcessRecipeResult<ProductionNestDefinition>;
  readonly prepareProductionNest: (
    definition: ProductionNestDefinition,
  ) => ProcessRecipeResult<PreparedProductionNest>;
  readonly acceptProductionNest: (
    prepared: PreparedProductionNest,
    result: ProductionNestResult,
    acceptPartial?: boolean,
  ) => ProcessRecipeResult<number>;
};
type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;
export function productionNestActions(set: Setter, get: () => AppState): ProductionNestActions {
  return {
    saveProductionNestDefinition: (definition) => {
      const parsed = parseProductionNestDefinition(definition);
      if (parsed.kind === 'invalid') return parsed;
      if (parsed.value === undefined)
        return { kind: 'invalid', reason: 'Define production parts first.' };
      const value = parsed.value;
      set((state) => ({
        project: { ...state.project, productionNest: value },
        undoStack: pushUndo(state.project, state.undoStack, 'Production part quantities'),
        redoStack: [],
        dirty: true,
      }));
      return { kind: 'ok', value };
    },
    prepareProductionNest: (definition) => prepareProductionNest(get().project, definition),
    acceptProductionNest: (prepared, result, acceptPartial = false) => {
      if (get().project !== prepared.project)
        return {
          kind: 'invalid',
          reason: 'Artwork or setup changed. Calculate the quantity layout again.',
        };
      const materialized = materializeProductionSheets(prepared, result, acceptPartial);
      if (materialized.kind === 'invalid') return materialized;
      const error = visitWorkflowArchives(materialized.value);
      if (error !== null) return { kind: 'invalid', reason: error };
      let applied = false;
      set((state) => {
        if (state.project !== prepared.project) return state;
        applied = true;
        return {
          project: materialized.value,
          undoStack: pushUndo(state.project, state.undoStack, 'Quantity production sheets'),
          redoStack: [],
          dirty: true,
        };
      });
      return applied
        ? { kind: 'ok', value: result.produced }
        : { kind: 'invalid', reason: 'Artwork changed before accepting the production sheets.' };
    },
  };
}
