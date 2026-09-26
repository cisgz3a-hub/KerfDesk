// The LightBurn gap batch 3 store actions (ADR-410) that live outside the
// existing selection, clipboard and vector-path slices, composed here so the
// store gains one slice instead of several.

import type { AppState } from './store';
import { offsetShapesActions, type OffsetShapesActions } from './offset-shapes-actions';
import { selectionQueryActions, type SelectionQueryActions } from './selection-query-actions';

export type EditingToolsActions = OffsetShapesActions & SelectionQueryActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function editingToolsActions(set: Setter): EditingToolsActions {
  return { ...offsetShapesActions(set), ...selectionQueryActions(set) };
}
