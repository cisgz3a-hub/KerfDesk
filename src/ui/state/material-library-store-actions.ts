import {
  materialPresetActions as singlePresetActions,
  type MaterialPresetActions as SinglePresetActions,
} from './material-preset-actions';
import { processRecipeActions, type ProcessRecipeActions } from './process-recipe-actions';

export type LibraryActions = SinglePresetActions & ProcessRecipeActions;

export function libraryActions(set: Parameters<typeof processRecipeActions>[0]): LibraryActions {
  return { ...singlePresetActions(set), ...processRecipeActions(set) };
}
