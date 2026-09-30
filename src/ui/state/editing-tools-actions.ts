// The LightBurn gap batch 3 and 5 store actions (ADR-410, ADR-480) that live outside the
// existing selection, clipboard and vector-path slices, composed here so the
// store gains one slice instead of several. The laser tab tool (ADR-494) joins
// them for the same reason.

import type { AppState } from './store';
import { designToolsActions, type DesignToolsActions } from './design-tools-actions';
import { laserTabActions, type LaserTabActions } from './laser-tab-actions';
import { offsetShapesActions, type OffsetShapesActions } from './offset-shapes-actions';
import { selectionQueryActions, type SelectionQueryActions } from './selection-query-actions';

export type EditingToolsActions = OffsetShapesActions &
  SelectionQueryActions &
  DesignToolsActions &
  LaserTabActions;

type Setter = (fn: (state: AppState) => AppState | Partial<AppState>) => void;

export function editingToolsActions(
  set: Setter,
  copySet: Setter,
  get: () => AppState,
): EditingToolsActions {
  return {
    ...offsetShapesActions(set, copySet, get),
    ...selectionQueryActions(set),
    ...designToolsActions(set, copySet),
    ...laserTabActions(set),
  };
}
